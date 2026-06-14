const crypto = require('crypto');
const os = require('os');
const pty = require('node-pty');
const { Terminal: HeadlessTerminal } = require('@xterm/headless');
const { EventEmitter } = require('events');
const { stripTerminalControls } = require('./text-utils');

const MAX_OUTPUT_CHARS = 4 * 1024 * 1024;

function createSessionId() {
  return crypto.randomUUID();
}

class TerminalSession extends EventEmitter {
  constructor(options = {}) {
    super();

    this.id = options.id || createSessionId();
    this.shell = options.shell || process.env.SHELL || '/bin/zsh';
    this.cwd = options.cwd || os.homedir();
    this.cols = options.cols || 100;
    this.rows = options.rows || 30;
    this.createdAt = new Date().toISOString();
    this.generation = 0;

    this.output = '';
    this.outputStartOffset = 0;
    this.outputOffset = 0;
    this.lastInputAt = null;
    this.lastOutputAt = null;
    this.exited = false;
    this.exitCode = null;
    this.signal = null;

    this.screenReady = Promise.resolve();
    this.spawnPty();
  }

  spawnPty() {
    this.exited = false;
    this.exitCode = null;
    this.signal = null;
    this.output = '';
    this.outputStartOffset = 0;
    this.outputOffset = 0;
    this.lastOutputAt = null;
    this.generation += 1;

    this.screenTerminal = new HeadlessTerminal({
      allowProposedApi: true,
      cols: this.cols,
      rows: this.rows,
      scrollback: 5000,
      logLevel: 'off'
    });
    this.screenReady = Promise.resolve();

    this.pty = pty.spawn(this.shell, ['-l'], {
      name: 'xterm-256color',
      cols: this.cols,
      rows: this.rows,
      cwd: this.cwd,
      env: {
        ...process.env,
        TERM: 'xterm-256color',
        COLORTERM: 'truecolor'
      }
    });

    this.pty.onData((data) => {
      this.appendOutput(data);
      this.emit('output', {
        sessionId: this.id,
        data,
        nextOffset: this.outputOffset
      });
    });

    this.pty.onExit(({ exitCode, signal }) => {
      this.exited = true;
      this.exitCode = exitCode;
      this.signal = signal;
      this.emit('exit', {
        sessionId: this.id,
        exitCode,
        signal
      });
    });
  }

  appendOutput(data) {
    this.output += data;
    this.outputOffset += data.length;
    this.lastOutputAt = new Date().toISOString();

    this.screenReady = this.screenReady
      .catch(() => {})
      .then(
        () =>
          new Promise((resolve) => {
            this.screenTerminal.write(data, resolve);
          })
      );

    if (this.output.length > MAX_OUTPUT_CHARS) {
      const trimCount = this.output.length - MAX_OUTPUT_CHARS;
      this.output = this.output.slice(trimCount);
      this.outputStartOffset += trimCount;
    }
  }

  metadata() {
    return {
      id: this.id,
      shell: this.shell,
      cwd: this.cwd,
      cols: this.cols,
      rows: this.rows,
      generation: this.generation,
      createdAt: this.createdAt,
      exited: this.exited,
      exitCode: this.exitCode,
      signal: this.signal,
      lastInputAt: this.lastInputAt,
      lastOutputAt: this.lastOutputAt,
      outputStartOffset: this.outputStartOffset,
      outputOffset: this.outputOffset
    };
  }

  getOutputSince(offset = this.outputStartOffset) {
    const requestedOffset = Number.isFinite(Number(offset))
      ? Number(offset)
      : this.outputStartOffset;

    if (requestedOffset <= this.outputStartOffset) {
      return {
        reset: requestedOffset < this.outputStartOffset,
        since: this.outputStartOffset,
        nextOffset: this.outputOffset,
        data: this.output
      };
    }

    if (requestedOffset >= this.outputOffset) {
      return {
        reset: false,
        since: this.outputOffset,
        nextOffset: this.outputOffset,
        data: ''
      };
    }

    const relativeOffset = requestedOffset - this.outputStartOffset;
    return {
      reset: false,
      since: requestedOffset,
      nextOffset: this.outputOffset,
      data: this.output.slice(relativeOffset)
    };
  }

  async getScreen() {
    await this.screenReady;
    const buffer = this.screenTerminal.buffer.active;
    const lines = [];
    for (let row = 0; row < this.rows; row += 1) {
      const line = buffer.getLine(buffer.viewportY + row);
      lines.push(line ? line.translateToString(true) : '');
    }

    while (lines.length > 0 && lines[lines.length - 1] === '') {
      lines.pop();
    }

    return {
      sessionId: this.id,
      cols: this.cols,
      rows: this.rows,
      cursorX: buffer.cursorX,
      cursorY: buffer.cursorY,
      bufferType: buffer.type,
      lines,
      text: lines.join('\n'),
      outputOffset: this.outputOffset,
      lastOutputAt: this.lastOutputAt
    };
  }

  async getState({ hasPendingApproval = false, paused = false } = {}) {
    if (this.exited) {
      return this.buildState('exited', { hasPendingApproval, paused });
    }
    if (hasPendingApproval) {
      return this.buildState('approval_needed', { hasPendingApproval, paused });
    }
    if (paused) {
      return this.buildState('waiting_for_input', { hasPendingApproval, paused, reason: 'Agent control is paused.' });
    }

    const screen = await this.getScreen();
    const text = screen.text;
    const plain = stripTerminalControls(text);
    const lines = plain.split('\n').map((line) => line.trimEnd());
    const lastNonEmpty = [...lines].reverse().find((line) => line.trim()) || '';
    const recentOutputMs = this.lastOutputAt ? Date.now() - Date.parse(this.lastOutputAt) : Infinity;

    if (/(^|[\s~\w./-])[%$#]\s*$/.test(lastNonEmpty)) {
      return this.buildState('shell_prompt', { hasPendingApproval, paused, screen });
    }

    if (
      /❯\s*$/.test(lastNonEmpty) ||
      /Enter to confirm|Esc to cancel|Do you want|Would you like|approval|permission|Continue\?/i.test(plain)
    ) {
      return this.buildState('waiting_for_input', { hasPendingApproval, paused, screen });
    }

    if (/Claude|Codex|thinking|Running|Warping|Cooking|tokens/i.test(plain)) {
      return this.buildState(recentOutputMs < 8000 ? 'running' : 'tui_prompt', {
        hasPendingApproval,
        paused,
        screen
      });
    }

    if (recentOutputMs < 2000) {
      return this.buildState('running', { hasPendingApproval, paused, screen });
    }

    return this.buildState('unknown', { hasPendingApproval, paused, screen });
  }

  buildState(state, extras = {}) {
    return {
      sessionId: this.id,
      state,
      exited: this.exited,
      paused: Boolean(extras.paused),
      hasPendingApproval: Boolean(extras.hasPendingApproval),
      reason: extras.reason || null,
      outputOffset: this.outputOffset,
      lastInputAt: this.lastInputAt,
      lastOutputAt: this.lastOutputAt
    };
  }

  write(data) {
    if (this.exited) {
      throw new Error('Terminal session has exited.');
    }

    this.lastInputAt = new Date().toISOString();
    this.pty.write(data);
  }

  sendCommand(command, appendEnter = true) {
    const suffix = appendEnter ? '\r' : '';
    this.write(`${command}${suffix}`);
  }

  interrupt() {
    this.write('\x03');
  }

  resize(cols, rows) {
    const nextCols = Math.max(20, Math.min(500, Number(cols) || this.cols));
    const nextRows = Math.max(5, Math.min(200, Number(rows) || this.rows));

    this.cols = nextCols;
    this.rows = nextRows;
    this.pty.resize(nextCols, nextRows);
    this.screenTerminal.resize(nextCols, nextRows);
  }

  restart(options = {}) {
    this.dispose();
    this.cwd = options.cwd || this.cwd;
    this.shell = options.shell || this.shell;
    this.spawnPty();
    this.emit('restart', {
      sessionId: this.id,
      generation: this.generation
    });
  }

  dispose() {
    if (this.pty && !this.exited) {
      this.pty.kill();
    }
  }
}

module.exports = {
  TerminalSession,
  createSessionId
};

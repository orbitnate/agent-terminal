const crypto = require('crypto');
const os = require('os');
const { EventEmitter } = require('events');
const { TerminalSession } = require('./terminal-session');
const { AuditLog } = require('./audit-log');
const { TaskStore } = require('./task-store');
const { classifyCommand, classifyRawInput } = require('./policy');
const { escapeRegExp, shellQuote, stripTerminalControls, summarizeInput } = require('./text-utils');

const LAUNCH_PROFILES = {
  'claude-opus': {
    label: 'Claude Opus',
    command: 'claude --model opus --effort high'
  },
  'claude-plan': {
    label: 'Claude Opus Plan Mode',
    command: 'claude --model opus --permission-mode plan'
  },
  codex: {
    label: 'Codex',
    command: 'codex'
  }
};

function createHttpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

class AgentTerminalController extends EventEmitter {
  constructor({ runtimeRoot }) {
    super();
    this.runtimeRoot = runtimeRoot;
    this.sessions = new Map();
    this.sessionPaused = new Set();
    this.apiEnabled = true;
    this.agentPaused = false;
    this.activeSessionId = null;
    this.audit = new AuditLog({ runtimeRoot });
    this.tasks = new TaskStore({ runtimeRoot });
  }

  createSession(options = {}) {
    const session = new TerminalSession({
      cwd: options.cwd || os.homedir(),
      shell: options.shell,
      cols: options.cols || 120,
      rows: options.rows || 34
    });
    session.setMaxListeners(100);
    this.sessions.set(session.id, session);
    if (!this.activeSessionId) {
      this.activeSessionId = session.id;
    }

    session.on('output', (payload) => {
      this.emit('session:output', payload);
    });
    session.on('exit', (payload) => {
      this.audit.log({ type: 'session_exit', ...payload });
      this.emit('session:exit', payload);
      this.emitSessionsChanged();
      this.emit('notification', {
        title: 'Terminal exited',
        body: `Session ${session.id.slice(0, 8)} exited with code ${payload.exitCode}.`
      });
    });
    session.on('restart', (payload) => {
      this.audit.log({ type: 'session_restart', ...payload });
      this.emitSessionsChanged();
    });

    this.audit.log({ type: 'session_create', sessionId: session.id, cwd: session.cwd, shell: session.shell });
    this.emitSessionsChanged();
    return session;
  }

  emitSessionsChanged() {
    this.emit('sessions:changed', {
      activeSessionId: this.activeSessionId,
      sessions: this.listSessions()
    });
  }

  listSessions() {
    return Array.from(this.sessions.values()).map((session) => ({
      ...session.metadata(),
      paused: this.sessionPaused.has(session.id)
    }));
  }

  getSession(id) {
    const session = this.sessions.get(id);
    if (!session) {
      throw createHttpError(404, `Unknown terminal session: ${id}`);
    }
    return session;
  }

  setActiveSession(id) {
    this.getSession(id);
    this.activeSessionId = id;
    this.emitSessionsChanged();
    return this.getSession(id);
  }

  getActiveSession() {
    return this.getSession(this.activeSessionId);
  }

  deleteSession(id, source = 'ui') {
    const session = this.getSession(id);
    const wasActive = this.activeSessionId === id;
    const replacementOptions = {
      cwd: session.cwd,
      shell: session.shell,
      cols: session.cols,
      rows: session.rows
    };

    this.sessions.delete(id);
    this.sessionPaused.delete(id);
    session.dispose();
    this.audit.log({ type: 'session_delete', sessionId: id, source });

    if (wasActive) {
      const nextSession =
        Array.from(this.sessions.values()).find((candidate) => !candidate.exited) ||
        Array.from(this.sessions.values())[0] ||
        null;
      this.activeSessionId = nextSession ? nextSession.id : null;
    }

    if (!this.activeSessionId) {
      this.createSession(replacementOptions);
    } else {
      this.emitSessionsChanged();
    }

    const activeSession = this.getActiveSession();
    return {
      ok: true,
      deletedSessionId: id,
      activeSessionId: this.activeSessionId,
      session: activeSession.metadata(),
      output: activeSession.getOutputSince(),
      sessions: this.listSessions()
    };
  }

  getControlState() {
    return {
      apiEnabled: this.apiEnabled,
      agentPaused: this.agentPaused,
      activeSessionId: this.activeSessionId
    };
  }

  setApiEnabled(enabled, source = 'ui') {
    this.apiEnabled = Boolean(enabled);
    this.audit.log({ type: 'api_enabled_set', enabled: this.apiEnabled, source });
    this.emit('control:changed', this.getControlState());
    return this.getControlState();
  }

  pauseAgents(source = 'ui') {
    this.agentPaused = true;
    this.audit.log({ type: 'agent_pause', source });
    this.emit('control:changed', this.getControlState());
    return this.getControlState();
  }

  resumeAgents(source = 'ui') {
    this.agentPaused = false;
    this.audit.log({ type: 'agent_resume', source });
    this.emit('control:changed', this.getControlState());
    return this.getControlState();
  }

  pauseSession(id, source = 'ui') {
    this.getSession(id);
    this.sessionPaused.add(id);
    this.audit.log({ type: 'session_pause', sessionId: id, source });
    this.emitSessionsChanged();
  }

  resumeSession(id, source = 'ui') {
    this.getSession(id);
    this.sessionPaused.delete(id);
    this.audit.log({ type: 'session_resume', sessionId: id, source });
    this.emitSessionsChanged();
  }

  assertAgentCanWrite(sessionId) {
    if (!this.apiEnabled) {
      throw createHttpError(423, 'Agent control API is disabled.');
    }
    if (this.agentPaused) {
      throw createHttpError(423, 'Agent control is paused.');
    }
    if (this.sessionPaused.has(sessionId)) {
      throw createHttpError(423, 'This session is paused.');
    }
  }

  async sendInput(sessionId, payload, options = {}) {
    const source = options.source || 'api';
    const session = this.getSession(sessionId);

    if (source !== 'human') {
      this.assertAgentCanWrite(sessionId);
    }

    const action = {
      type: 'input',
      sessionId,
      source,
      command: payload.command,
      data: payload.data,
      enter: payload.enter !== false,
      display: payload.command || payload.data || ''
    };

    return this.handleAction(action, () => {
      if (typeof payload.command === 'string') {
        session.sendCommand(payload.command, payload.enter !== false);
      } else if (typeof payload.data === 'string') {
        session.write(payload.data);
      } else {
        throw createHttpError(400, 'Send "command" or "data".');
      }

      this.audit.log({
        type: 'input_sent',
        sessionId,
        source,
        mode: payload.command ? 'command' : 'raw',
        summary: summarizeInput(action.display)
      });
      this.emit('agent:input', {
        sessionId,
        source,
        mode: payload.command ? 'command' : 'raw',
        summary: summarizeInput(action.display)
      });

      return {
        ok: true,
        session: session.metadata()
      };
    });
  }

  async launch(sessionId, payload = {}, options = {}) {
    const source = options.source || 'api';
    const session = this.getSession(sessionId);
    if (source !== 'human') {
      this.assertAgentCanWrite(sessionId);
    }

    const profile = payload.profile || 'claude-opus';
    const launchProfile = LAUNCH_PROFILES[profile];
    if (!launchProfile) {
      throw createHttpError(400, `Unknown launch profile: ${profile}`);
    }

    const command = payload.prompt
      ? `${launchProfile.command} ${shellQuote(payload.prompt)}`
      : launchProfile.command;

    const action = {
      type: 'launch',
      sessionId,
      source,
      command,
      profile,
      display: command
    };

    return this.handleAction(action, () => {
      session.sendCommand(command, true);
      const task = payload.objective
        ? this.tasks.createTask({
            objective: payload.objective,
            rules: payload.rules || '',
            cwd: session.cwd,
            profile,
            sessionId
          })
        : null;
      this.audit.log({ type: 'launch', sessionId, source, profile, command });
      this.emit('agent:input', {
        sessionId,
        source,
        mode: 'launch',
        summary: command
      });
      return { ok: true, profile, command, task, session: session.metadata() };
    });
  }

  async runCommand(sessionId, payload = {}, options = {}) {
    const source = options.source || 'api';
    const session = this.getSession(sessionId);
    if (source !== 'human') {
      this.assertAgentCanWrite(sessionId);
    }

    const command = String(payload.command || '').trim();
    if (!command) {
      throw createHttpError(400, 'Missing command.');
    }

    const action = {
      type: 'run',
      sessionId,
      source,
      command,
      display: command
    };

    return this.handleAction(action, async () => {
      if (!payload.force) {
        const state = await this.getSessionState(sessionId);
        if (state.state !== 'shell_prompt' && state.state !== 'unknown') {
          throw createHttpError(409, `Session is not at a shell prompt; state is ${state.state}. Use force to override.`);
        }
      }
      return this.executeRunCommand(session, command, {
        timeoutMs: Number(payload.timeoutMs || 120000),
        source
      });
    });
  }

  async executeRunCommand(session, command, { timeoutMs, source }) {
    const token = crypto.randomBytes(12).toString('hex');
    const startMarker = `__AGENT_TERMINAL_RUN_START_${token}__`;
    const endMarker = `__AGENT_TERMINAL_RUN_END_${token}__`;
    const startOffset = session.outputOffset;
    const wrapped = `printf '\\n${startMarker}\\n'; ( ${command} ); __agent_terminal_status=$?; printf '\\n${endMarker}:%s\\n' "$__agent_terminal_status"`;
    const completedMarker = new RegExp(`^${escapeRegExp(endMarker)}:\\d+$`, 'm');

    this.audit.log({ type: 'run_start', sessionId: session.id, source, command });
    this.emit('agent:input', {
      sessionId: session.id,
      source,
      mode: 'run',
      summary: summarizeInput(command)
    });

    const waitForEnd = this.waitForOutput(session, startOffset, (raw) => completedMarker.test(stripTerminalControls(raw)), timeoutMs);
    session.write(`${wrapped}\r`);
    const raw = await waitForEnd;
    const plain = stripTerminalControls(raw);
    const startMatch = plain.match(new RegExp(`^${escapeRegExp(startMarker)}$`, 'm'));
    const endMatch = plain.match(new RegExp(`^${escapeRegExp(endMarker)}:(\\d+)$`, 'm'));
    const exitCode = endMatch ? Number(endMatch[1]) : null;
    let output = plain;
    if (startMatch && endMatch && endMatch.index > startMatch.index) {
      output = plain.slice(startMatch.index + startMatch[0].length, endMatch.index).trim();
    }

    const result = {
      ok: exitCode === 0,
      sessionId: session.id,
      command,
      exitCode,
      output,
      nextOffset: session.outputOffset
    };
    this.audit.log({
      type: 'run_end',
      sessionId: session.id,
      source,
      command,
      exitCode,
      outputSummary: summarizeInput(output, 240)
    });
    this.emit('notification', {
      title: exitCode === 0 ? 'Command finished' : 'Command failed',
      body: summarizeInput(command)
    });
    return result;
  }

  waitForOutput(session, offset, predicate, timeoutMs) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        session.off('output', handleOutput);
        reject(createHttpError(504, 'Timed out waiting for command to finish.'));
      }, timeoutMs);

      const check = () => {
        const raw = session.getOutputSince(offset).data;
        if (predicate(raw)) {
          clearTimeout(timeout);
          session.off('output', handleOutput);
          resolve(raw);
        }
      };

      const handleOutput = () => check();
      session.on('output', handleOutput);
      check();
    });
  }

  async handleAction(action, execute) {
    if (action.source === 'human') {
      return execute();
    }

    const decision =
      action.type === 'input' && action.data && !action.command
        ? classifyRawInput(action.data)
        : action.type === 'launch'
          ? { decision: 'allow', reason: 'Known launch profile.' }
          : classifyCommand(action.command || action.display);

    if (decision.decision === 'block') {
      this.audit.log({
        type: 'action_blocked',
        sessionId: action.sessionId,
        source: action.source,
        actionType: action.type,
        reason: decision.reason,
        summary: summarizeInput(action.display)
      });
      throw createHttpError(403, decision.reason);
    }

    return execute();
  }

  async getScreen(sessionId) {
    return this.getSession(sessionId).getScreen();
  }

  async getSessionState(sessionId) {
    const paused = this.agentPaused || this.sessionPaused.has(sessionId) || !this.apiEnabled;
    return this.getSession(sessionId).getState({ paused });
  }

  interrupt(sessionId, source = 'api') {
    const session = this.getSession(sessionId);
    session.interrupt();
    this.audit.log({ type: 'interrupt', sessionId, source });
    return { ok: true, session: session.metadata() };
  }

  restart(sessionId, options = {}, source = 'api') {
    const session = this.getSession(sessionId);
    session.restart(options);
    this.audit.log({ type: 'restart', sessionId, source });
    return { ok: true, session: session.metadata() };
  }
}

module.exports = {
  AgentTerminalController,
  LAUNCH_PROFILES
};

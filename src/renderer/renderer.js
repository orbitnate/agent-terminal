const shellElement = document.querySelector('.shell');
const terminalElement = document.getElementById('terminal');
const sessionIdElement = document.getElementById('sessionId');
const apiUrlElement = document.getElementById('apiUrl');
const apiTokenElement = document.getElementById('apiToken');
const shellLabelElement = document.getElementById('shellLabel');
const connectionStatusElement = document.getElementById('connectionStatus');
const lastActionElement = document.getElementById('lastAction');
const copySessionButton = document.getElementById('copySession');
const copyApiButton = document.getElementById('copyApi');
const copyTokenButton = document.getElementById('copyToken');
const copyAgentPromptButton = document.getElementById('copyAgentPrompt');
const toggleSessionsButton = document.getElementById('toggleSessions');
const sessionPanelElement = document.getElementById('sessionPanel');
const sessionListElement = document.getElementById('sessionList');
const sessionCountElement = document.getElementById('sessionCount');
const activeSessionCountElement = document.getElementById('activeSessionCount');
const newSessionButton = document.getElementById('newSession');
const toggleApiButton = document.getElementById('toggleApi');
const pauseAgentsButton = document.getElementById('pauseAgents');
const termSizeElement = document.getElementById('termSize');
const revealTokenButton = document.getElementById('revealToken');

let bootstrap = null;
let control = null;
let resizeFrame = null;
let tokenRevealed = false;

const fitAddon = new FitAddon.FitAddon();
const terminal = new Terminal({
  cursorBlink: true,
  convertEol: true,
  fontFamily: '"SF Mono", Menlo, Monaco, Consolas, monospace',
  fontSize: 13,
  lineHeight: 1.22,
  scrollback: 5000,
  theme: {
    background: '#07090c',
    foreground: '#c7cdd8',
    cursor: '#7c7bff',
    cursorAccent: '#07090c',
    selectionBackground: '#2a2a52',
    black: '#0a0b0f',
    red: '#ff6b6b',
    green: '#46d08a',
    yellow: '#f5b544',
    blue: '#7fb0ff',
    magenta: '#9d9bff',
    cyan: '#56d7e0',
    white: '#e8eaf0',
    brightBlack: '#565b67',
    brightRed: '#ff8e96',
    brightGreen: '#7fe3b6',
    brightYellow: '#e0b45f',
    brightBlue: '#9dc3ff',
    brightMagenta: '#b9b8ff',
    brightCyan: '#7be7ef',
    brightWhite: '#ffffff'
  }
});

terminal.loadAddon(fitAddon);
terminal.open(terminalElement);
terminal.focus();

function resizeTerminal() {
  if (resizeFrame) {
    window.cancelAnimationFrame(resizeFrame);
  }

  resizeFrame = window.requestAnimationFrame(() => {
    resizeFrame = null;
    try {
      if (!terminalElement.clientWidth || !terminalElement.clientHeight) {
        return;
      }

      fitAddon.fit();
      termSizeElement.textContent = `${terminal.cols}×${terminal.rows}`;
      window.agentTerminal.resize({
        cols: terminal.cols,
        rows: terminal.rows
      });
    } catch (error) {
      setLastAction(`Terminal resize skipped: ${error.message}`);
    }
  });
}

function setLastAction(text) {
  lastActionElement.textContent = text;
}

const copiedTimers = new WeakMap();

// The status line is far from the button and gets overwritten by terminal
// output, so confirm a copy on the button itself with a brief "Copied!" flash.
function flashButtonCopied(button, copiedLabel = 'Copied!') {
  const label = button.querySelector('.btn-label');
  if (!label) return;
  if (!copiedTimers.has(button)) {
    button.dataset.originalLabel = label.textContent;
  } else {
    clearTimeout(copiedTimers.get(button));
  }
  label.textContent = copiedLabel;
  button.classList.add('copied');
  const timer = setTimeout(() => {
    label.textContent = button.dataset.originalLabel;
    button.classList.remove('copied');
    copiedTimers.delete(button);
  }, 1400);
  copiedTimers.set(button, timer);
}

function reportError(action, error) {
  setLastAction(`${action} failed: ${error.message}`);
}

function setCurrentSession(session) {
  sessionIdElement.textContent = session.id.slice(0, 8);
  shellLabelElement.textContent = `${session.shell} in ${session.cwd}`;
}

function formatCount(count, singular, plural) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function folderName(cwd) {
  const parts = String(cwd || '').split('/').filter(Boolean);
  return parts.length ? parts[parts.length - 1] : '/';
}

function homePath(cwd) {
  const value = String(cwd || '');
  const match = value.match(/^\/(?:Users|home)\/[^/]+(\/.*)?$/);
  return match ? `~${match[1] || ''}` : value;
}

function statusLabel(session) {
  if (session.exited) {
    return 'Done';
  }
  if (session.paused) {
    return 'Paused';
  }
  return 'Active';
}

async function runUiAction(action, callback) {
  try {
    return await callback();
  } catch (error) {
    reportError(action, error);
    return null;
  }
}

function renderSessions(payload) {
  const sessions = payload.sessions || [];
  const activeCount = sessions.filter((session) => !session.exited).length;
  sessionCountElement.textContent = formatCount(sessions.length, 'terminal', 'terminals');
  activeSessionCountElement.textContent = formatCount(activeCount, 'active', 'active');
  sessionListElement.innerHTML = '';

  if (!sessions.length) {
    sessionListElement.className = 'session-list empty';
    sessionListElement.textContent = 'No terminals yet';
    return;
  }

  sessionListElement.className = 'session-list';
  for (const session of sessions) {
    const selected = session.id === payload.activeSessionId;
    const item = document.createElement('div');
    item.setAttribute('role', 'button');
    item.setAttribute('tabindex', '0');
    item.className = [
      'session-item',
      selected ? 'selected' : '',
      session.exited ? 'done' : 'running'
    ].filter(Boolean).join(' ');
    item.title = `${session.id}\n${session.cwd}`;

    const state = document.createElement('span');
    state.className = 'session-state';
    state.setAttribute('aria-hidden', 'true');

    const main = document.createElement('span');
    main.className = 'session-main';
    const id = document.createElement('strong');
    id.textContent = folderName(session.cwd);
    const cwd = document.createElement('span');
    cwd.textContent = homePath(session.cwd);
    main.append(id, cwd);

    const badge = document.createElement('span');
    badge.className = 'session-badge';
    badge.textContent = statusLabel(session);

    const deleteButton = document.createElement('button');
    deleteButton.type = 'button';
    deleteButton.className = 'session-delete';
    deleteButton.setAttribute('aria-label', `Delete terminal ${session.id.slice(0, 8)}`);
    deleteButton.setAttribute('title', 'Delete terminal');
    deleteButton.textContent = 'x';
    deleteButton.addEventListener('click', (event) => {
      event.stopPropagation();
      runUiAction('Delete session', () => deleteSession(session.id));
    });
    deleteButton.addEventListener('keydown', (event) => {
      event.stopPropagation();
    });

    item.append(state, main, badge, deleteButton);
    item.addEventListener('click', () => {
      if (!selected) {
        runUiAction('Switch session', () => switchToSession(session.id));
      }
    });
    item.addEventListener('keydown', (event) => {
      if ((event.key === 'Enter' || event.key === ' ') && !selected) {
        event.preventDefault();
        runUiAction('Switch session', () => switchToSession(session.id));
      }
    });
    sessionListElement.appendChild(item);
  }
}

function renderControl(nextControl) {
  control = nextControl;
  toggleApiButton.textContent = control.apiEnabled ? 'Disable Control' : 'Enable Control';
  pauseAgentsButton.textContent = control.agentPaused ? 'Resume Agents' : 'Pause Agents';

  connectionStatusElement.classList.remove('paused', 'disabled', 'exited');
  if (!control.apiEnabled) {
    connectionStatusElement.textContent = 'Control disabled';
    connectionStatusElement.classList.add('disabled');
    return;
  }

  if (control.agentPaused) {
    connectionStatusElement.textContent = 'Agent control paused';
    connectionStatusElement.classList.add('paused');
    return;
  }

  connectionStatusElement.textContent = bootstrap
    ? `Listening on ${bootstrap.api.host}:${bootstrap.api.port}`
    : 'Local control active';
}

async function switchToSession(id) {
  const payload = await window.agentTerminal.setActiveSession(id);
  bootstrap = {
    ...bootstrap,
    activeSessionId: payload.activeSessionId,
    session: payload.session,
    sessions: payload.sessions
  };
  terminal.clear();
  terminal.write(payload.output.data || '');
  setCurrentSession(payload.session);
  renderSessions(payload);
  resizeTerminal();
}

async function deleteSession(id) {
  const payload = await window.agentTerminal.deleteSession(id);
  bootstrap = {
    ...bootstrap,
    activeSessionId: payload.activeSessionId,
    session: payload.session,
    sessions: payload.sessions
  };
  terminal.clear();
  terminal.write(payload.output.data || '');
  setCurrentSession(payload.session);
  renderSessions(payload);
  setLastAction(`Deleted terminal ${payload.deletedSessionId.slice(0, 8)}`);
  resizeTerminal();
}

terminal.onData((data) => {
  window.agentTerminal.sendInput(data);
});

window.agentTerminal.onOutput((data) => {
  terminal.write(data);
  setLastAction(`Output received ${new Date().toLocaleTimeString()}`);
});

window.agentTerminal.onExit((payload) => {
  connectionStatusElement.textContent = `Terminal exited with code ${payload.exitCode}`;
  connectionStatusElement.classList.add('exited');
});

window.agentTerminal.onSessionsChanged((payload) => {
  bootstrap = {
    ...(bootstrap || {}),
    activeSessionId: payload.activeSessionId,
    sessions: payload.sessions
  };
  renderSessions(payload);
});

window.agentTerminal.onControlChanged((payload) => {
  renderControl(payload);
});

window.agentTerminal.onAgentInput((payload) => {
  setLastAction(`${payload.source} ${payload.mode}: ${payload.summary}`);
});

copySessionButton.addEventListener('click', async () => {
  if (!bootstrap) return;
  await runUiAction('Copy session ID', async () => {
    await window.agentTerminal.copy(bootstrap.session.id);
    setLastAction('Session ID copied');
  });
});

copyApiButton.addEventListener('click', async () => {
  if (!bootstrap) return;
  await runUiAction('Copy API URL', async () => {
    await window.agentTerminal.copy(bootstrap.api.baseUrl);
    setLastAction('API URL copied');
  });
});

copyTokenButton.addEventListener('click', async () => {
  if (!bootstrap) return;
  await runUiAction('Copy API token', async () => {
    await window.agentTerminal.copy(bootstrap.token);
    setLastAction('API token copied');
  });
});

function maskedToken(token) {
  return `${token.slice(0, 6)}…${token.slice(-4)}`;
}

function renderToken() {
  if (!bootstrap) return;
  apiTokenElement.textContent = tokenRevealed ? bootstrap.token : maskedToken(bootstrap.token);
  revealTokenButton.textContent = tokenRevealed ? 'Hide' : 'Reveal';
}

function toggleTokenReveal(event) {
  event.preventDefault();
  event.stopPropagation();
  if (!bootstrap) return;
  tokenRevealed = !tokenRevealed;
  renderToken();
}

revealTokenButton.addEventListener('click', toggleTokenReveal);
revealTokenButton.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' || event.key === ' ') {
    toggleTokenReveal(event);
  }
});

copyAgentPromptButton.addEventListener('click', async () => {
  if (!bootstrap) return;
  await runUiAction('Copy agent prompt', async () => {
    const prompt = await window.agentTerminal.getAgentPrompt();
    await window.agentTerminal.copy(prompt);
    setLastAction('Agent prompt copied');
    flashButtonCopied(copyAgentPromptButton);
  });
});

newSessionButton.addEventListener('click', async () => {
  if (!bootstrap) return;
  await runUiAction('Create session', async () => {
    const payload = await window.agentTerminal.createSession({ cwd: bootstrap.session.cwd });
    await switchToSession(payload.activeSessionId);
  });
});

toggleSessionsButton.addEventListener('click', () => {
  const nextOpen = shellElement.classList.contains('sessions-collapsed');
  setSessionPanelOpen(nextOpen);
});

toggleApiButton.addEventListener('click', async () => {
  await runUiAction('Toggle control', async () => {
    const next = !(control && control.apiEnabled);
    renderControl(await window.agentTerminal.setApiEnabled(next));
  });
});

pauseAgentsButton.addEventListener('click', async () => {
  await runUiAction('Toggle agent pause', async () => {
    if (control && control.agentPaused) {
      renderControl(await window.agentTerminal.resumeAgents());
    } else {
      renderControl(await window.agentTerminal.pauseAgents());
    }
  });
});

window.addEventListener('resize', resizeTerminal);

function setSessionPanelOpen(open) {
  shellElement.classList.toggle('sessions-collapsed', !open);
  toggleSessionsButton.setAttribute('aria-expanded', String(open));
  sessionPanelElement.setAttribute('aria-hidden', String(!open));
  sessionPanelElement.inert = !open;
  window.localStorage.setItem('agentTerminalSessionsOpen', open ? 'true' : 'false');
  resizeTerminal();
}

window.agentTerminal.getBootstrap().then((payload) => {
  bootstrap = payload;
  setSessionPanelOpen(window.localStorage.getItem('agentTerminalSessionsOpen') !== 'false');
  setCurrentSession(payload.session);
  apiUrlElement.textContent = payload.api.baseUrl;
  renderToken();
  renderControl(payload.control);
  renderSessions(payload);
  if (payload.output && payload.output.data) {
    terminal.write(payload.output.data);
  }
  resizeTerminal();
}).catch((error) => {
  reportError('Start Agent Terminal', error);
});

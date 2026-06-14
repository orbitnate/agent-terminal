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
const sessionSelect = document.getElementById('sessionSelect');
const newSessionButton = document.getElementById('newSession');
const toggleApiButton = document.getElementById('toggleApi');
const pauseAgentsButton = document.getElementById('pauseAgents');
const approvalsElement = document.getElementById('approvals');
const activityElement = document.getElementById('activity');

let bootstrap = null;
let control = null;
let activity = [];

const fitAddon = new FitAddon.FitAddon();
const terminal = new Terminal({
  cursorBlink: true,
  convertEol: true,
  fontFamily: '"SF Mono", Menlo, Monaco, Consolas, monospace',
  fontSize: 13,
  lineHeight: 1.22,
  scrollback: 5000,
  theme: {
    background: '#090b10',
    foreground: '#edf2f7',
    cursor: '#f2c14e',
    selectionBackground: '#39475d',
    black: '#0f1217',
    red: '#f06d6d',
    green: '#5ec4a7',
    yellow: '#f2c14e',
    blue: '#67a7ff',
    magenta: '#c695ff',
    cyan: '#56d7e0',
    white: '#eff3f8',
    brightBlack: '#6b7788',
    brightRed: '#ff8585',
    brightGreen: '#74d9bc',
    brightYellow: '#ffd66e',
    brightBlue: '#8dbfff',
    brightMagenta: '#d8b3ff',
    brightCyan: '#7be7ef',
    brightWhite: '#ffffff'
  }
});

terminal.loadAddon(fitAddon);
terminal.open(terminalElement);
terminal.focus();

function resizeTerminal() {
  fitAddon.fit();
  window.agentTerminal.resize({
    cols: terminal.cols,
    rows: terminal.rows
  });
}

function setLastAction(text) {
  lastActionElement.textContent = text;
}

function renderSessions(payload) {
  const sessions = payload.sessions || [];
  sessionSelect.innerHTML = '';
  for (const session of sessions) {
    const option = document.createElement('option');
    option.value = session.id;
    option.textContent = `${session.id.slice(0, 8)} · ${session.cwd}`;
    option.selected = session.id === payload.activeSessionId;
    sessionSelect.appendChild(option);
  }
}

function renderControl(nextControl) {
  control = nextControl;
  toggleApiButton.textContent = control.apiEnabled ? 'Disable Control' : 'Enable Control';
  pauseAgentsButton.textContent = control.agentPaused ? 'Resume Agents' : 'Pause Agents';
  connectionStatusElement.textContent = control.apiEnabled
    ? control.agentPaused
      ? 'Agent control paused'
      : `Listening on ${bootstrap.api.host}:${bootstrap.api.port}`
    : 'Agent control disabled';
}

function renderApprovals(approvals = []) {
  approvalsElement.innerHTML = '';
  if (!approvals.length) {
    approvalsElement.className = 'approval-list empty';
    approvalsElement.textContent = 'No pending approvals';
    return;
  }

  approvalsElement.className = 'approval-list';
  for (const approval of approvals) {
    const item = document.createElement('article');
    item.className = 'approval';
    item.innerHTML = `
      <strong>${approval.action.type}: ${approval.action.summary}</strong>
      <p>${approval.reason}</p>
      <div class="approval-actions">
        <button class="text-button approve">Approve</button>
        <button class="text-button danger deny">Deny</button>
      </div>
    `;
    item.querySelector('.approve').addEventListener('click', () => window.agentTerminal.approve(approval.id));
    item.querySelector('.deny').addEventListener('click', () => window.agentTerminal.deny(approval.id));
    approvalsElement.appendChild(item);
  }
}

function renderActivity() {
  activityElement.innerHTML = '';
  if (!activity.length) {
    activityElement.className = 'activity-list empty';
    activityElement.textContent = 'No agent actions yet';
    return;
  }

  activityElement.className = 'activity-list';
  for (const event of activity.slice(0, 20)) {
    const item = document.createElement('article');
    item.className = 'activity';
    item.innerHTML = `
      <strong>${event.mode} · ${event.source}</strong>
      <p>${event.summary}</p>
    `;
    activityElement.appendChild(item);
  }
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
  sessionIdElement.textContent = payload.session.id.slice(0, 8);
  shellLabelElement.textContent = `${payload.session.shell} in ${payload.session.cwd}`;
  renderSessions(payload);
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
  connectionStatusElement.style.color = 'var(--danger)';
});

window.agentTerminal.onSessionsChanged((payload) => {
  renderSessions(payload);
});

window.agentTerminal.onControlChanged((payload) => {
  renderControl(payload);
});

window.agentTerminal.onApprovalsChanged((payload) => {
  renderApprovals(payload);
});

window.agentTerminal.onAgentInput((payload) => {
  activity.unshift(payload);
  activity = activity.slice(0, 50);
  renderActivity();
  setLastAction(`${payload.source} ${payload.mode}: ${payload.summary}`);
});

copySessionButton.addEventListener('click', async () => {
  if (!bootstrap) return;
  await window.agentTerminal.copy(bootstrap.session.id);
  setLastAction('Session ID copied');
});

copyApiButton.addEventListener('click', async () => {
  if (!bootstrap) return;
  await window.agentTerminal.copy(bootstrap.api.baseUrl);
  setLastAction('API URL copied');
});

copyTokenButton.addEventListener('click', async () => {
  if (!bootstrap) return;
  await window.agentTerminal.copy(bootstrap.token);
  setLastAction('API token copied');
});

sessionSelect.addEventListener('change', () => {
  switchToSession(sessionSelect.value);
});

newSessionButton.addEventListener('click', async () => {
  const payload = await window.agentTerminal.createSession({ cwd: bootstrap.session.cwd });
  await switchToSession(payload.activeSessionId);
});

toggleApiButton.addEventListener('click', async () => {
  const next = !(control && control.apiEnabled);
  renderControl(await window.agentTerminal.setApiEnabled(next));
});

pauseAgentsButton.addEventListener('click', async () => {
  if (control && control.agentPaused) {
    renderControl(await window.agentTerminal.resumeAgents());
  } else {
    renderControl(await window.agentTerminal.pauseAgents());
  }
});

window.addEventListener('resize', resizeTerminal);

window.agentTerminal.getBootstrap().then((payload) => {
  bootstrap = payload;
  sessionIdElement.textContent = payload.session.id.slice(0, 8);
  apiUrlElement.textContent = payload.api.baseUrl;
  apiTokenElement.textContent = `${payload.token.slice(0, 6)}…${payload.token.slice(-4)}`;
  shellLabelElement.textContent = `${payload.session.shell} in ${payload.session.cwd}`;
  renderControl(payload.control);
  renderSessions(payload);
  renderApprovals(payload.approvals);
  renderActivity();
  if (payload.output && payload.output.data) {
    terminal.write(payload.output.data);
  }
  resizeTerminal();
});

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('agentTerminal', {
  getBootstrap: () => ipcRenderer.invoke('terminal:get-bootstrap'),
  getAgentPrompt: () => ipcRenderer.invoke('terminal:get-agent-prompt'),
  copy: (text) => ipcRenderer.invoke('terminal:copy', text),
  sendInput: (data) => ipcRenderer.send('terminal:input', data),
  resize: (size) => ipcRenderer.send('terminal:resize', size),
  setActiveSession: (id) => ipcRenderer.invoke('terminal:set-active-session', id),
  createSession: (options) => ipcRenderer.invoke('terminal:create-session', options),
  deleteSession: (id) => ipcRenderer.invoke('terminal:delete-session', id),
  setApiEnabled: (enabled) => ipcRenderer.invoke('control:set-api-enabled', enabled),
  pauseAgents: () => ipcRenderer.invoke('control:pause-agents'),
  resumeAgents: () => ipcRenderer.invoke('control:resume-agents'),
  onOutput: (callback) => ipcRenderer.on('terminal:output', (event, data) => callback(data)),
  onExit: (callback) => ipcRenderer.on('terminal:exit', (event, payload) => callback(payload)),
  onSessionsChanged: (callback) => ipcRenderer.on('sessions:changed', (event, payload) => callback(payload)),
  onControlChanged: (callback) => ipcRenderer.on('control:changed', (event, payload) => callback(payload)),
  onAgentInput: (callback) => ipcRenderer.on('agent:input', (event, payload) => callback(payload))
});

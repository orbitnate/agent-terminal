const crypto = require('crypto');
const path = require('path');
const { app, BrowserWindow, ipcMain, clipboard, Notification } = require('electron');
const { AgentTerminalController } = require('./controller');
const { createApiServer } = require('./api-server');
const { ensureRuntimeDirs, getRuntimeRoot, writeConnectionInfo } = require('./runtime-store');

let mainWindow = null;
let controller = null;
let apiInfo = null;
let apiServer = null;
let apiToken = null;
let runtimeRoot = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1240,
    height: 820,
    minWidth: 900,
    minHeight: 560,
    title: 'Agent Terminal',
    backgroundColor: '#12151b',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function sendToWindow(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

function writeRuntimeInfo() {
  if (!apiInfo || !controller || !apiToken) return;
  writeConnectionInfo(
    {
      app: 'agent-terminal',
      baseUrl: apiInfo.baseUrl,
      token: apiToken,
      activeSessionId: controller.activeSessionId,
      sessions: controller.listSessions(),
      updatedAt: new Date().toISOString()
    },
    runtimeRoot
  );
}

function attachControllerEvents() {
  controller.on('session:output', (payload) => {
    if (payload.sessionId === controller.activeSessionId) {
      sendToWindow('terminal:output', payload.data);
    }
  });
  controller.on('session:exit', (payload) => {
    if (payload.sessionId === controller.activeSessionId) {
      sendToWindow('terminal:exit', payload);
    }
  });
  controller.on('sessions:changed', (payload) => {
    writeRuntimeInfo();
    sendToWindow('sessions:changed', payload);
  });
  controller.on('control:changed', (payload) => {
    writeRuntimeInfo();
    sendToWindow('control:changed', payload);
  });
  controller.on('approval:changed', (payload) => {
    sendToWindow('approval:changed', payload);
  });
  controller.on('agent:input', (payload) => {
    sendToWindow('agent:input', payload);
  });
  controller.on('notification', (payload) => {
    if (Notification.isSupported()) {
      new Notification(payload).show();
    }
  });
}

async function startApiServer() {
  const preferredPort = Number(process.env.AGENT_TERMINAL_PORT || 9876);
  const attempts = [preferredPort, 0];
  let lastError = null;

  for (const port of attempts) {
    apiServer = createApiServer({
      controller,
      token: apiToken,
      host: '127.0.0.1',
      port
    });

    try {
      apiInfo = await apiServer.listen();
      return;
    } catch (error) {
      lastError = error;
      await apiServer.close().catch(() => {});
    }
  }

  throw lastError;
}

ipcMain.handle('terminal:get-bootstrap', async () => {
  const session = controller.getActiveSession();
  return {
    api: apiInfo,
    token: apiToken,
    control: controller.getControlState(),
    activeSessionId: controller.activeSessionId,
    sessions: controller.listSessions(),
    session: session.metadata(),
    output: session.getOutputSince(),
    approvals: controller.listApprovals()
  };
});

ipcMain.handle('terminal:copy', (event, text) => {
  clipboard.writeText(String(text || ''));
  return true;
});

ipcMain.handle('terminal:set-active-session', async (event, id) => {
  const session = controller.setActiveSession(id);
  writeRuntimeInfo();
  return {
    activeSessionId: id,
    session: session.metadata(),
    output: session.getOutputSince(),
    sessions: controller.listSessions()
  };
});

ipcMain.handle('terminal:create-session', async (event, options = {}) => {
  const session = controller.createSession(options);
  controller.setActiveSession(session.id);
  writeRuntimeInfo();
  return {
    activeSessionId: session.id,
    session: session.metadata(),
    output: session.getOutputSince(),
    sessions: controller.listSessions()
  };
});

ipcMain.handle('control:set-api-enabled', (event, enabled) => controller.setApiEnabled(Boolean(enabled), 'ui'));
ipcMain.handle('control:pause-agents', () => controller.pauseAgents('ui'));
ipcMain.handle('control:resume-agents', () => controller.resumeAgents('ui'));
ipcMain.handle('approval:approve', async (event, id) => controller.approve(id, 'ui'));
ipcMain.handle('approval:deny', (event, id) => controller.deny(id, 'ui'));

ipcMain.on('terminal:input', (event, data) => {
  controller.sendInput(controller.activeSessionId, { data }, { source: 'human' }).catch((error) => {
    sendToWindow('agent:input', {
      sessionId: controller.activeSessionId,
      source: 'system',
      mode: 'error',
      summary: error.message
    });
  });
});

ipcMain.on('terminal:resize', (event, size) => {
  const session = controller.getActiveSession();
  session.resize(size.cols, size.rows);
});

app.whenReady().then(async () => {
  runtimeRoot = ensureRuntimeDirs(getRuntimeRoot());
  apiToken = crypto.randomBytes(32).toString('base64url');
  controller = new AgentTerminalController({ runtimeRoot });
  attachControllerEvents();
  controller.createSession();
  await startApiServer();
  writeRuntimeInfo();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('before-quit', async () => {
  if (controller) {
    for (const session of controller.sessions.values()) {
      session.dispose();
    }
  }
  if (apiServer) {
    await apiServer.close().catch(() => {});
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

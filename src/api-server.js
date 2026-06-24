const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const { buildAgentManifest, buildOpenApi } = require('./agent-contract');

function writeSse(res, event, payload) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function hostnameFromHeader(hostHeader) {
  if (!hostHeader) {
    return '';
  }
  return hostHeader.replace(/^\[/, '').replace(/\](:\d+)?$/, '').replace(/:\d+$/, '');
}

function isLoopbackHostname(host) {
  return host === '127.0.0.1' || host === 'localhost' || host === '::1';
}

function isLoopbackHost(hostHeader) {
  if (!hostHeader) {
    return false;
  }
  return isLoopbackHostname(hostnameFromHeader(hostHeader));
}

// Loopback is always allowed. `allowedHosts` opts in extra hostnames/IPs
// (e.g. a Tailscale MagicDNS name or tailnet IP) for remote access.
function isHostAllowed(hostHeader, allowedHosts = []) {
  if (!hostHeader) {
    return false;
  }
  const host = hostnameFromHeader(hostHeader);
  if (isLoopbackHostname(host)) {
    return true;
  }
  return allowedHosts.includes(host);
}

function isAllowedOrigin(origin, allowedHosts = []) {
  if (!origin) {
    return true;
  }
  try {
    const url = new URL(origin);
    return isLoopbackHostname(url.hostname) || allowedHosts.includes(url.hostname);
  } catch (error) {
    return false;
  }
}

function isAuthorized(req, token) {
  const header = req.headers.authorization || '';
  const bearer = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : null;
  return bearer === token || req.headers['x-agent-terminal-token'] === token;
}

function createApiServer({
  controller,
  token,
  host = '127.0.0.1',
  port = 9876,
  allowedHosts = [],
  advertiseBaseUrl = null
}) {
  // This API can spawn shells and run arbitrary commands, so binding it beyond
  // loopback without a strong secret would expose a remote shell. Fail loudly.
  if (!isLoopbackHostname(host)) {
    if (!token || String(token).length < 16) {
      throw new Error(
        'Refusing to bind Agent Terminal to a non-loopback address without a strong token. ' +
          'Set AGENT_TERMINAL_TOKEN to a secret of at least 16 characters.'
      );
    }
    // eslint-disable-next-line no-console
    console.warn(
      `[agent-terminal] API is bound to ${host} and reachable beyond this machine. ` +
        'It grants shell access; keep the token secret and prefer a private network (e.g. Tailscale).'
    );
  }

  const app = express();
  const server = http.createServer(app);
  const wss = new WebSocket.Server({ noServer: true });

  function currentBaseUrl() {
    if (advertiseBaseUrl) {
      return advertiseBaseUrl;
    }
    const address = server.address();
    const currentPort = address && typeof address === 'object' ? address.port : port;
    return `http://${host}:${currentPort}`;
  }

  function publicManifest() {
    return buildAgentManifest({
      baseUrl: currentBaseUrl(),
      runtimeRoot: controller.runtimeRoot,
      control: controller.getControlState()
    });
  }

  app.use((req, res, next) => {
    if (!isHostAllowed(req.headers.host || '', allowedHosts)) {
      res.status(403).json({ ok: false, error: 'Host is not allowed.' });
      return;
    }

    if (!isAllowedOrigin(req.headers.origin, allowedHosts)) {
      res.status(403).json({ ok: false, error: 'Browser origin is not allowed.' });
      return;
    }

    next();
  });

  app.get('/.well-known/agent-terminal.json', (req, res) => {
    res.json(publicManifest());
  });

  app.get('/agent-terminal/v1/manifest', (req, res) => {
    res.json(publicManifest());
  });

  app.get('/openapi.json', (req, res) => {
    res.json(buildOpenApi({ baseUrl: currentBaseUrl() }));
  });

  app.use((req, res, next) => {
    if (!isAuthorized(req, token)) {
      res.status(401).json({ ok: false, error: 'Missing or invalid Agent Terminal token.' });
      return;
    }

    next();
  });

  app.use(express.json({ limit: '1mb' }));
  app.use(express.text({ type: 'text/plain', limit: '1mb' }));

  app.get('/health', (req, res) => {
    res.json({
      ok: true,
      app: 'agent-terminal',
      sessions: controller.sessions.size,
      control: controller.getControlState()
    });
  });

  app.get('/control', (req, res) => {
    res.json({ ok: true, control: controller.getControlState() });
  });

  app.post('/control/api-enabled', (req, res) => {
    res.json({ ok: true, control: controller.setApiEnabled(req.body.enabled !== false, 'api') });
  });

  app.post('/control/pause', (req, res) => {
    res.json({ ok: true, control: controller.pauseAgents('api') });
  });

  app.post('/control/resume', (req, res) => {
    res.json({ ok: true, control: controller.resumeAgents('api') });
  });

  app.get('/sessions', (req, res) => {
    res.json({
      sessions: controller.listSessions(),
      activeSessionId: controller.activeSessionId
    });
  });

  app.post('/sessions', (req, res) => {
    const session = controller.createSession({
      cwd: req.body.cwd,
      shell: req.body.shell,
      cols: req.body.cols,
      rows: req.body.rows
    });
    res.status(201).json({ ok: true, session: session.metadata() });
  });

  app.get('/sessions/:id', (req, res, next) => {
    try {
      res.json({ session: controller.getSession(req.params.id).metadata() });
    } catch (error) {
      next(error);
    }
  });

  app.delete('/sessions/:id', (req, res, next) => {
    try {
      res.json(controller.deleteSession(req.params.id, 'api'));
    } catch (error) {
      next(error);
    }
  });

  app.get('/sessions/:id/output', (req, res, next) => {
    try {
      const session = controller.getSession(req.params.id);
      res.json(session.getOutputSince(req.query.since));
    } catch (error) {
      next(error);
    }
  });

  app.get('/sessions/:id/screen', async (req, res, next) => {
    try {
      res.json(await controller.getScreen(req.params.id));
    } catch (error) {
      next(error);
    }
  });

  app.get('/sessions/:id/state', async (req, res, next) => {
    try {
      res.json(await controller.getSessionState(req.params.id));
    } catch (error) {
      next(error);
    }
  });

  app.post('/sessions/:id/input', async (req, res, next) => {
    try {
      const payload =
        typeof req.body === 'string'
          ? { data: req.body }
          : {
              command: req.body.command,
              data: req.body.data,
              enter: req.body.enter
            };
      const result = await controller.sendInput(req.params.id, payload, { source: 'api' });
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  app.post('/sessions/:id/resize', (req, res, next) => {
    try {
      const session = controller.getSession(req.params.id);
      session.resize(req.body.cols, req.body.rows);
      res.json({ ok: true, session: session.metadata() });
    } catch (error) {
      next(error);
    }
  });

  app.post('/sessions/:id/launch', async (req, res, next) => {
    try {
      const result = await controller.launch(req.params.id, req.body, { source: 'api' });
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  app.post('/sessions/:id/run', async (req, res, next) => {
    try {
      const result = await controller.runCommand(req.params.id, req.body, { source: 'api' });
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  app.post('/sessions/:id/interrupt', (req, res, next) => {
    try {
      res.json(controller.interrupt(req.params.id, 'api'));
    } catch (error) {
      next(error);
    }
  });

  app.post('/sessions/:id/restart', (req, res, next) => {
    try {
      res.json(controller.restart(req.params.id, req.body || {}, 'api'));
    } catch (error) {
      next(error);
    }
  });

  app.post('/sessions/:id/pause', (req, res, next) => {
    try {
      controller.pauseSession(req.params.id, 'api');
      res.json({ ok: true, control: controller.getControlState() });
    } catch (error) {
      next(error);
    }
  });

  app.post('/sessions/:id/resume', (req, res, next) => {
    try {
      controller.resumeSession(req.params.id, 'api');
      res.json({ ok: true, control: controller.getControlState() });
    } catch (error) {
      next(error);
    }
  });

  app.get('/sessions/:id/stream', (req, res, next) => {
    let session;
    try {
      session = controller.getSession(req.params.id);
    } catch (error) {
      next(error);
      return;
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive'
    });

    writeSse(res, 'snapshot', session.getOutputSince(req.query.since));

    const handleOutput = (payload) => {
      writeSse(res, 'output', {
        data: payload.data,
        nextOffset: payload.nextOffset
      });
    };
    const handleExit = (payload) => {
      writeSse(res, 'exit', payload);
    };
    const heartbeat = setInterval(() => {
      res.write(': heartbeat\n\n');
    }, 15000);

    session.on('output', handleOutput);
    session.on('exit', handleExit);

    req.on('close', () => {
      clearInterval(heartbeat);
      session.off('output', handleOutput);
      session.off('exit', handleExit);
    });
  });

  app.get('/tasks', (req, res) => {
    res.json({ tasks: controller.tasks.listTasks() });
  });

  app.post('/tasks', (req, res) => {
    res.status(201).json({
      ok: true,
      task: controller.tasks.createTask({
        objective: req.body.objective,
        rules: req.body.rules,
        cwd: req.body.cwd,
        profile: req.body.profile,
        sessionId: req.body.sessionId
      })
    });
  });

  app.get('/tasks/:id', (req, res, next) => {
    try {
      const task = controller.tasks.getTask(req.params.id);
      if (!task) {
        res.status(404).json({ ok: false, error: 'Unknown task.' });
        return;
      }
      res.json({ task });
    } catch (error) {
      next(error);
    }
  });

  app.post('/tasks/:id/checkpoints', (req, res, next) => {
    try {
      res.json({ ok: true, task: controller.tasks.addCheckpoint(req.params.id, req.body) });
    } catch (error) {
      next(error);
    }
  });

  server.on('upgrade', (req, socket, head) => {
    if (!isHostAllowed(req.headers.host || '', allowedHosts) || !isAllowedOrigin(req.headers.origin, allowedHosts) || !isAuthorized(req, token)) {
      socket.destroy();
      return;
    }

    const url = new URL(req.url, `http://${req.headers.host || `${host}:${port}`}`);
    const match = url.pathname.match(/^\/sessions\/([^/]+)\/ws$/);

    if (!match) {
      socket.destroy();
      return;
    }

    let session;
    try {
      session = controller.getSession(match[1]);
    } catch (error) {
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      ws.send(JSON.stringify({ type: 'session', session: session.metadata() }));
      ws.send(JSON.stringify({ type: 'snapshot', ...session.getOutputSince(url.searchParams.get('since')) }));

      const handleOutput = (payload) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'output', data: payload.data, nextOffset: payload.nextOffset }));
        }
      };
      const handleExit = (payload) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'exit', ...payload }));
        }
      };

      session.on('output', handleOutput);
      session.on('exit', handleExit);

      ws.on('message', async (message) => {
        const text = message.toString();
        try {
          const payload = JSON.parse(text);
          if (payload.type === 'command' && typeof payload.command === 'string') {
            await controller.sendInput(session.id, { command: payload.command, enter: payload.enter !== false }, { source: 'api' });
            return;
          }
          if (payload.type === 'input' && typeof payload.data === 'string') {
            await controller.sendInput(session.id, { data: payload.data }, { source: 'api' });
            return;
          }
        } catch (error) {
          ws.send(JSON.stringify({ type: 'error', error: error.message }));
          return;
        }

        try {
          await controller.sendInput(session.id, { data: text }, { source: 'api' });
        } catch (error) {
          ws.send(JSON.stringify({ type: 'error', error: error.message }));
        }
      });

      ws.on('close', () => {
        session.off('output', handleOutput);
        session.off('exit', handleExit);
      });
    });
  });

  app.use((error, req, res, next) => {
    if (res.headersSent) {
      next(error);
      return;
    }

    res.status(error.statusCode || 500).json({
      ok: false,
      error: error.message || 'Unexpected error'
    });
  });

  return {
    app,
    server,
    host,
    port,
    listen() {
      return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, () => {
          server.off('error', reject);
          const address = server.address();
          resolve({
            host,
            port: address.port,
            baseUrl: advertiseBaseUrl || `http://${host}:${address.port}`
          });
        });
      });
    },
    close() {
      return new Promise((resolve) => {
        server.close(() => resolve());
      });
    }
  };
}

module.exports = {
  createApiServer,
  isLoopbackHost,
  isHostAllowed,
  isAllowedOrigin
};

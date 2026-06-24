const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { createApiServer } = require('../src/api-server');

function createFakeController() {
  let inputCalls = 0;
  let deleteCalls = 0;
  return {
    sessions: new Map([['session-1', {}]]),
    activeSessionId: 'session-1',
    get inputCalls() {
      return inputCalls;
    },
    get deleteCalls() {
      return deleteCalls;
    },
    getControlState() {
      return { apiEnabled: true, agentPaused: false };
    },
    listSessions() {
      return [{ id: 'session-1', shell: '/bin/zsh', cwd: '/tmp' }];
    },
    getSession() {
      return {
        metadata() {
          return { id: 'session-1' };
        },
        getOutputSince() {
          return { data: '', nextOffset: 0 };
        },
        resize() {}
      };
    },
    async sendInput() {
      inputCalls += 1;
      return { ok: true };
    },
    deleteSession(id) {
      deleteCalls += 1;
      return {
        ok: true,
        deletedSessionId: id,
        activeSessionId: 'session-1',
        sessions: this.listSessions()
      };
    }
  };
}

function request(baseUrl, options = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(options.path || '/health', baseUrl);
    const payload = options.body || null;
    const req = http.request(
      url,
      {
        method: options.method || 'GET',
        headers: {
          ...(options.headers || {}),
          ...(payload ? { 'content-length': Buffer.byteLength(payload) } : {})
        }
      },
      (res) => {
        let raw = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          raw += chunk;
        });
        res.on('end', () => resolve({ statusCode: res.statusCode, raw }));
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

test('API requires a token', async () => {
  const server = createApiServer({ controller: createFakeController(), token: 'secret', port: 0 });
  const info = await server.listen();
  try {
    const res = await request(info.baseUrl);
    assert.equal(res.statusCode, 401);
  } finally {
    await server.close();
  }
});

test('API rejects wrong tokens and accepts the right token', async () => {
  const server = createApiServer({ controller: createFakeController(), token: 'secret', port: 0 });
  const info = await server.listen();
  try {
    const wrong = await request(info.baseUrl, { headers: { authorization: 'Bearer nope' } });
    assert.equal(wrong.statusCode, 401);

    const right = await request(info.baseUrl, { headers: { authorization: 'Bearer secret' } });
    assert.equal(right.statusCode, 200);
  } finally {
    await server.close();
  }
});

test('API exposes public agent discovery without exposing control', async () => {
  const server = createApiServer({ controller: createFakeController(), token: 'secret', port: 0 });
  const info = await server.listen();
  try {
    const manifest = await request(info.baseUrl, { path: '/.well-known/agent-terminal.json' });
    assert.equal(manifest.statusCode, 200);
    const parsedManifest = JSON.parse(manifest.raw);
    assert.equal(parsedManifest.app, 'agent-terminal');
    assert.equal(parsedManifest.auth.requiredForActions, true);
    assert.equal(parsedManifest.auth.token, undefined);
    assert.ok(parsedManifest.capabilities.includes('session.list'));
    assert.ok(parsedManifest.transports.mcp.args[0].endsWith('bin/agent-terminal-mcp.js'));

    const openapi = await request(info.baseUrl, { path: '/openapi.json' });
    assert.equal(openapi.statusCode, 200);
    const parsedOpenApi = JSON.parse(openapi.raw);
    assert.equal(parsedOpenApi.openapi, '3.1.0');
    assert.ok(parsedOpenApi.paths['/sessions']);

    const protectedRoute = await request(info.baseUrl, { path: '/sessions' });
    assert.equal(protectedRoute.statusCode, 401);
  } finally {
    await server.close();
  }
});

test('API rejects non-loopback Host headers', async () => {
  const server = createApiServer({ controller: createFakeController(), token: 'secret', port: 0 });
  const info = await server.listen();
  try {
    const res = await request(info.baseUrl, {
      headers: {
        host: 'evil.example',
        authorization: 'Bearer secret'
      }
    });
    assert.equal(res.statusCode, 403);
  } finally {
    await server.close();
  }
});

test('API accepts an allowlisted non-loopback Host header', async () => {
  const server = createApiServer({
    controller: createFakeController(),
    token: 'secret',
    port: 0,
    allowedHosts: ['box.tailnet.ts.net', '100.64.0.1']
  });
  const info = await server.listen();
  try {
    const allowed = await request(info.baseUrl, {
      headers: { host: 'box.tailnet.ts.net:9876', authorization: 'Bearer secret' }
    });
    assert.equal(allowed.statusCode, 200);

    const stillBlocked = await request(info.baseUrl, {
      headers: { host: 'evil.example', authorization: 'Bearer secret' }
    });
    assert.equal(stillBlocked.statusCode, 403);
  } finally {
    await server.close();
  }
});

test('refuses to bind non-loopback without a strong token', () => {
  assert.throws(
    () => createApiServer({ controller: createFakeController(), token: 'short', host: '0.0.0.0', port: 0 }),
    /strong token/
  );
});

test('advertises the configured public base URL', async () => {
  const server = createApiServer({
    controller: createFakeController(),
    token: 'a-sufficiently-long-secret',
    port: 0,
    advertiseBaseUrl: 'http://box.tailnet.ts.net:9876'
  });
  const info = await server.listen();
  try {
    assert.equal(info.baseUrl, 'http://box.tailnet.ts.net:9876');
  } finally {
    await server.close();
  }
});

test('browser-style cross-origin text/plain POST cannot type into terminal', async () => {
  const controller = createFakeController();
  const server = createApiServer({ controller, token: 'secret', port: 0 });
  const info = await server.listen();
  try {
    const res = await request(info.baseUrl, {
      method: 'POST',
      path: '/sessions/session-1/input',
      headers: {
        origin: 'https://evil.example',
        'content-type': 'text/plain'
      },
      body: 'echo unsafe'
    });
    assert.equal(res.statusCode, 403);
    assert.equal(controller.inputCalls, 0);
  } finally {
    await server.close();
  }
});

test('API deletes a terminal session', async () => {
  const controller = createFakeController();
  const server = createApiServer({ controller, token: 'secret', port: 0 });
  const info = await server.listen();
  try {
    const res = await request(info.baseUrl, {
      method: 'DELETE',
      path: '/sessions/session-1',
      headers: { authorization: 'Bearer secret' }
    });
    assert.equal(res.statusCode, 200);
    assert.equal(controller.deleteCalls, 1);
  } finally {
    await server.close();
  }
});

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { createApiServer } = require('../src/api-server');

function createFakeController() {
  let inputCalls = 0;
  return {
    sessions: new Map([['session-1', {}]]),
    activeSessionId: 'session-1',
    get inputCalls() {
      return inputCalls;
    },
    getControlState() {
      return { apiEnabled: true, agentPaused: false, pendingApprovals: [] };
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

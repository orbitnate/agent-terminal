const http = require('http');
const { URL } = require('url');
const { readConnectionInfo } = require('./runtime-store');

function getClientConfig() {
  const runtime = readConnectionInfo() || {};
  return {
    baseUrl: new URL(process.env.AGENT_TERMINAL_URL || runtime.baseUrl || 'http://127.0.0.1:9876'),
    token: process.env.AGENT_TERMINAL_TOKEN || runtime.token || ''
  };
}

function requestJson(method, pathname, body) {
  const { baseUrl, token } = getClientConfig();

  return new Promise((resolve, reject) => {
    const url = new URL(pathname, baseUrl);
    const payload = body ? JSON.stringify(body) : null;
    const headers = {
      authorization: `Bearer ${token}`
    };
    if (payload) {
      headers['content-type'] = 'application/json';
      headers['content-length'] = Buffer.byteLength(payload);
    }

    const req = http.request(url, { method, headers }, (res) => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        raw += chunk;
      });
      res.on('end', () => {
        let parsed = null;
        try {
          parsed = raw ? JSON.parse(raw) : null;
        } catch (error) {
          reject(new Error(`Expected JSON but received: ${raw.slice(0, 200)}`));
          return;
        }

        if (res.statusCode >= 400) {
          reject(new Error((parsed && parsed.error) || `HTTP ${res.statusCode}`));
          return;
        }

        resolve(parsed);
      });
    });

    req.on('error', reject);
    if (payload) {
      req.write(payload);
    }
    req.end();
  });
}

function buildPath(pathname, query = {}) {
  const { baseUrl } = getClientConfig();
  const url = new URL(pathname, baseUrl);
  for (const [key, value] of Object.entries(query)) {
    if (value !== null && value !== undefined) {
      url.searchParams.set(key, value);
    }
  }
  return `${url.pathname}${url.search}`;
}

function streamSession(sessionId, since, onData, onError) {
  const { baseUrl, token } = getClientConfig();
  const url = new URL(buildPath(`/sessions/${sessionId}/stream`, { since }), baseUrl);
  const req = http.request(url, {
    method: 'GET',
    headers: {
      accept: 'text/event-stream',
      authorization: `Bearer ${token}`
    }
  });
  let buffer = '';

  req.on('response', (res) => {
    if (res.statusCode >= 400) {
      let raw = '';
      res.on('data', (chunk) => {
        raw += chunk.toString();
      });
      res.on('end', () => onError(new Error(raw || `HTTP ${res.statusCode}`)));
      return;
    }

    res.setEncoding('utf8');
    res.on('data', (chunk) => {
      buffer += chunk;
      const events = buffer.split('\n\n');
      buffer = events.pop();

      for (const event of events) {
        const dataLine = event
          .split('\n')
          .find((line) => line.startsWith('data: '));
        if (!dataLine) continue;

        onData(JSON.parse(dataLine.slice(6)));
      }
    });
  });

  req.on('error', onError);
  req.end();
}

module.exports = {
  getClientConfig,
  requestJson,
  buildPath,
  streamSession
};

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildAgentManifest, buildAgentPrompt } = require('../src/agent-contract');

test('agent prompt is self-contained: bakes in the base URL and token for paste-and-go', () => {
  const manifest = buildAgentManifest({
    baseUrl: 'https://box.tailnet.ts.net:9876',
    token: 'secret-token',
    includeToken: true,
    activeSessionId: 'session-123',
    sessions: [{ id: 'session-123' }]
  });

  const prompt = buildAgentPrompt(manifest);

  assert.match(prompt, /https:\/\/box\.tailnet\.ts\.net:9876/);
  assert.match(prompt, /Authorization: Bearer secret-token/);
  assert.match(prompt, /no setup/i);
  assert.match(prompt, /Current active session when this was copied: session-123/);
});

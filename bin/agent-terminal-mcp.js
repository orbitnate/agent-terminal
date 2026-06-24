#!/usr/bin/env node

const { requestJson } = require('../src/client');

let inputBuffer = Buffer.alloc(0);

const TOOLS = [
  {
    name: 'get_manifest',
    description: 'Read the Agent Terminal integration contract for coding agents.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'list_sessions',
    description: 'List visible Agent Terminal sessions.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'create_session',
    description: 'Create a new terminal session.',
    inputSchema: {
      type: 'object',
      properties: { cwd: { type: 'string' } }
    }
  },
  {
    name: 'delete_session',
    description: 'Delete a terminal session from the visible session list.',
    inputSchema: {
      type: 'object',
      required: ['sessionId'],
      properties: { sessionId: { type: 'string' } }
    }
  },
  {
    name: 'launch_agent',
    description: 'Launch Claude or Codex in a terminal session.',
    inputSchema: {
      type: 'object',
      required: ['sessionId', 'profile'],
      properties: {
        sessionId: { type: 'string' },
        profile: { type: 'string', enum: ['claude-opus', 'claude-plan', 'codex'] }
      }
    }
  },
  {
    name: 'send_input',
    description: 'Send text or a command to a terminal session.',
    inputSchema: {
      type: 'object',
      required: ['sessionId'],
      properties: {
        sessionId: { type: 'string' },
        command: { type: 'string' },
        data: { type: 'string' }
      }
    }
  },
  {
    name: 'read_screen',
    description: 'Read the clean current terminal screen.',
    inputSchema: {
      type: 'object',
      required: ['sessionId'],
      properties: { sessionId: { type: 'string' } }
    }
  },
  {
    name: 'read_output',
    description: 'Read raw terminal output, optionally from a previous offset.',
    inputSchema: {
      type: 'object',
      required: ['sessionId'],
      properties: {
        sessionId: { type: 'string' },
        since: { type: ['number', 'string'] }
      }
    }
  },
  {
    name: 'read_state',
    description: 'Read the inferred terminal state.',
    inputSchema: {
      type: 'object',
      required: ['sessionId'],
      properties: { sessionId: { type: 'string' } }
    }
  },
  {
    name: 'run_command',
    description: 'Run a shell command with completion markers.',
    inputSchema: {
      type: 'object',
      required: ['sessionId', 'command'],
      properties: {
        sessionId: { type: 'string' },
        command: { type: 'string' },
        force: { type: 'boolean' }
      }
    }
  },
  {
    name: 'interrupt_session',
    description: 'Send Ctrl-C to a terminal session.',
    inputSchema: {
      type: 'object',
      required: ['sessionId'],
      properties: { sessionId: { type: 'string' } }
    }
  },
  {
    name: 'restart_session',
    description: 'Restart a terminal session.',
    inputSchema: {
      type: 'object',
      required: ['sessionId'],
      properties: { sessionId: { type: 'string' } }
    }
  },
  {
    name: 'pause_session',
    description: 'Pause agent writes for all sessions.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'resume_session',
    description: 'Resume agent writes for all sessions.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'pause_agents',
    description: 'Pause agent writes for all sessions.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'resume_agents',
    description: 'Resume agent writes for all sessions.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'disable_control',
    description: 'Disable local API control until it is enabled again.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'enable_control',
    description: 'Enable local API control.',
    inputSchema: { type: 'object', properties: {} }
  }
];

function writeMessage(message) {
  const body = JSON.stringify(message);
  process.stdout.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
}

function result(id, payload) {
  writeMessage({ jsonrpc: '2.0', id, result: payload });
}

function error(id, code, message) {
  writeMessage({ jsonrpc: '2.0', id, error: { code, message } });
}

async function callTool(name, args = {}) {
  switch (name) {
    case 'get_manifest':
      return requestJson('GET', '/agent-terminal/v1/manifest');
    case 'list_sessions':
      return requestJson('GET', '/sessions');
    case 'create_session':
      return requestJson('POST', '/sessions', { cwd: args.cwd });
    case 'delete_session':
      return requestJson('DELETE', `/sessions/${args.sessionId}`);
    case 'launch_agent':
      return requestJson('POST', `/sessions/${args.sessionId}/launch`, { profile: args.profile });
    case 'send_input':
      return requestJson('POST', `/sessions/${args.sessionId}/input`, {
        command: args.command,
        data: args.data
      });
    case 'read_screen':
      return requestJson('GET', `/sessions/${args.sessionId}/screen`);
    case 'read_output':
      return requestJson('GET', `/sessions/${args.sessionId}/output${args.since !== undefined ? `?since=${encodeURIComponent(args.since)}` : ''}`);
    case 'read_state':
      return requestJson('GET', `/sessions/${args.sessionId}/state`);
    case 'run_command':
      return requestJson('POST', `/sessions/${args.sessionId}/run`, {
        command: args.command,
        force: args.force
      });
    case 'interrupt_session':
      return requestJson('POST', `/sessions/${args.sessionId}/interrupt`, {});
    case 'restart_session':
      return requestJson('POST', `/sessions/${args.sessionId}/restart`, {});
    case 'pause_session':
    case 'pause_agents':
      return requestJson('POST', '/control/pause', {});
    case 'resume_session':
    case 'resume_agents':
      return requestJson('POST', '/control/resume', {});
    case 'disable_control':
      return requestJson('POST', '/control/api-enabled', { enabled: false });
    case 'enable_control':
      return requestJson('POST', '/control/api-enabled', { enabled: true });
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

async function handleMessage(message) {
  if (message.method === 'initialize') {
    result(message.id, {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'agent-terminal', version: '0.1.0' }
    });
    return;
  }

  if (message.method === 'tools/list') {
    result(message.id, { tools: TOOLS });
    return;
  }

  if (message.method === 'tools/call') {
    try {
      const payload = await callTool(message.params.name, message.params.arguments || {});
      result(message.id, {
        content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }]
      });
    } catch (err) {
      result(message.id, {
        isError: true,
        content: [{ type: 'text', text: err.message }]
      });
    }
    return;
  }

  if (message.id !== undefined) {
    error(message.id, -32601, `Unknown method: ${message.method}`);
  }
}

function processBuffer() {
  while (true) {
    const headerEnd = inputBuffer.indexOf('\r\n\r\n');
    if (headerEnd === -1) return;

    const header = inputBuffer.slice(0, headerEnd).toString('utf8');
    const match = header.match(/Content-Length:\s*(\d+)/i);
    if (!match) {
      inputBuffer = Buffer.alloc(0);
      return;
    }

    const length = Number(match[1]);
    const messageStart = headerEnd + 4;
    const messageEnd = messageStart + length;
    if (inputBuffer.length < messageEnd) return;

    const body = inputBuffer.slice(messageStart, messageEnd).toString('utf8');
    inputBuffer = inputBuffer.slice(messageEnd);
    handleMessage(JSON.parse(body)).catch((err) => {
      console.error(err.message);
    });
  }
}

process.stdin.on('data', (chunk) => {
  inputBuffer = Buffer.concat([inputBuffer, chunk]);
  processBuffer();
});

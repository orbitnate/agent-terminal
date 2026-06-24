const path = require('path');
const pkg = require('../package.json');
const { getConnectionFile, getRuntimeRoot, readConnectionInfo } = require('./runtime-store');

const PROTOCOL_VERSION = 'agent-terminal.v1';

const CAPABILITIES = [
  'session.list',
  'session.create',
  'session.delete',
  'session.inspect',
  'session.read_output',
  'session.read_screen',
  'session.read_state',
  'session.send_input',
  'session.run_command',
  'session.launch_agent',
  'session.interrupt',
  'session.restart',
  'session.resize',
  'session.stream_sse',
  'session.stream_websocket',
  'control.pause',
  'control.resume',
  'control.disable',
  'control.enable',
  'task.list',
  'task.create',
  'task.checkpoint'
];

const ENDPOINTS = [
  { method: 'GET', path: '/health', purpose: 'Check whether the local API is up.' },
  { method: 'GET', path: '/control', purpose: 'Read control state.' },
  { method: 'POST', path: '/control/api-enabled', purpose: 'Enable or disable local agent control.' },
  { method: 'POST', path: '/control/pause', purpose: 'Pause agent writes.' },
  { method: 'POST', path: '/control/resume', purpose: 'Resume agent writes.' },
  { method: 'GET', path: '/sessions', purpose: 'List sessions and the active session.' },
  { method: 'POST', path: '/sessions', purpose: 'Create a session.' },
  { method: 'GET', path: '/sessions/{id}', purpose: 'Inspect one session.' },
  { method: 'DELETE', path: '/sessions/{id}', purpose: 'Delete one session.' },
  { method: 'GET', path: '/sessions/{id}/output', purpose: 'Read raw output since an offset.' },
  { method: 'GET', path: '/sessions/{id}/screen', purpose: 'Read the clean current screen.' },
  { method: 'GET', path: '/sessions/{id}/state', purpose: 'Read inferred prompt/running state.' },
  { method: 'GET', path: '/sessions/{id}/stream', purpose: 'Stream output with server-sent events.' },
  { method: 'WS', path: '/sessions/{id}/ws', purpose: 'Stream output and send input over WebSocket.' },
  { method: 'POST', path: '/sessions/{id}/input', purpose: 'Send raw terminal input or a command plus Enter.' },
  { method: 'POST', path: '/sessions/{id}/run', purpose: 'Run a shell command with completion markers.' },
  { method: 'POST', path: '/sessions/{id}/launch', purpose: 'Launch a known coding-agent profile.' },
  { method: 'POST', path: '/sessions/{id}/interrupt', purpose: 'Send Ctrl-C.' },
  { method: 'POST', path: '/sessions/{id}/restart', purpose: 'Restart the terminal process.' },
  { method: 'POST', path: '/sessions/{id}/resize', purpose: 'Resize the terminal.' },
  { method: 'GET', path: '/tasks', purpose: 'List supervisor task records.' },
  { method: 'POST', path: '/tasks', purpose: 'Create a supervisor task record.' },
  { method: 'GET', path: '/tasks/{id}', purpose: 'Read a supervisor task record.' },
  { method: 'POST', path: '/tasks/{id}/checkpoints', purpose: 'Append a task checkpoint.' }
];

const PROFILES = [
  {
    name: 'claude-opus',
    command: 'claude --model opus --effort high',
    purpose: 'Launch Claude Code directly on the high-effort Opus profile.'
  },
  {
    name: 'claude-plan',
    command: 'claude',
    purpose: 'Launch Claude Code without forcing a model.'
  },
  {
    name: 'codex',
    command: 'codex',
    purpose: 'Launch Codex in the selected terminal.'
  }
];

function repoRoot() {
  return path.resolve(__dirname, '..');
}

function helperPath() {
  return path.join(repoRoot(), 'bin', 'agent-terminal.js');
}

function mcpPath() {
  return path.join(repoRoot(), 'bin', 'agent-terminal-mcp.js');
}

function nodeCommand() {
  const executable = path.basename(process.execPath).toLowerCase();
  if (executable === 'node' || executable === 'node.exe') {
    return process.execPath;
  }
  return process.env.AGENT_TERMINAL_NODE || process.env.npm_node_execpath || 'node';
}

function normalizeBaseUrl(baseUrl) {
  return baseUrl || 'http://127.0.0.1:9876';
}

function buildMcpConfig() {
  return {
    mcpServers: {
      'agent-terminal': {
        command: nodeCommand(),
        args: [mcpPath()]
      }
    }
  };
}

function buildAgentManifest(options = {}) {
  const runtimeRoot = options.runtimeRoot || getRuntimeRoot();
  const runtimeFile = getConnectionFile(runtimeRoot);
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  const hasToken = Boolean(options.token);
  const manifest = {
    ok: true,
    app: pkg.name,
    name: 'Agent Terminal',
    version: pkg.version,
    protocolVersion: PROTOCOL_VERSION,
    description: pkg.description,
    baseUrl,
    auth: {
      requiredForActions: true,
      scheme: 'bearer',
      header: 'Authorization: Bearer <token>',
      alternateHeader: 'x-agent-terminal-token',
      tokenSources: [
        'AGENT_TERMINAL_TOKEN',
        runtimeFile
      ],
      tokenAvailable: hasToken
    },
    discovery: {
      runtimeFile,
      runtimeDir: runtimeRoot,
      urlEnv: 'AGENT_TERMINAL_URL',
      tokenEnv: 'AGENT_TERMINAL_TOKEN',
      wellKnownPath: '/.well-known/agent-terminal.json',
      manifestPath: '/agent-terminal/v1/manifest',
      openApiPath: '/openapi.json'
    },
    transports: {
      cli: {
        command: nodeCommand(),
        args: [helperPath()],
        examples: [
          `${nodeCommand()} ${helperPath()} discover --json`,
          `${nodeCommand()} ${helperPath()} list`,
          `${nodeCommand()} ${helperPath()} screen <session-id>`
        ]
      },
      mcp: {
        command: nodeCommand(),
        args: [mcpPath()],
        config: buildMcpConfig()
      },
      http: {
        baseUrl,
        endpoints: ENDPOINTS
      },
      sse: {
        path: '/sessions/{id}/stream',
        eventTypes: ['snapshot', 'output', 'exit']
      },
      websocket: {
        path: '/sessions/{id}/ws',
        outboundTypes: ['session', 'snapshot', 'output', 'exit', 'error'],
        inboundTypes: ['command', 'input']
      }
    },
    capabilities: CAPABILITIES,
    launchProfiles: PROFILES,
    conventions: {
      chooseSession: 'Call list_sessions or GET /sessions first, then use the exact session id.',
      shellCommands: 'Use run_command or POST /sessions/{id}/run when the terminal is at a shell prompt and an exit code matters.',
      tuiInput: 'Use send_input with data for interactive apps like Claude Code where text should go into the visible prompt.',
      screenRead: 'Use read_screen or GET /sessions/{id}/screen for a clean snapshot before deciding what to do next.',
      outputOffsets: 'Use nextOffset from output reads or streams to continue reading without replaying old output.'
    }
  };

  if (options.includeToken) {
    manifest.auth.token = options.token || null;
  }

  if (options.activeSessionId !== undefined || options.sessions !== undefined) {
    manifest.current = {
      activeSessionId: options.activeSessionId || null,
      sessions: options.sessions || []
    };
  }

  if (options.control) {
    manifest.control = options.control;
  }

  if (options.updatedAt) {
    manifest.updatedAt = options.updatedAt;
  }

  return manifest;
}

function discoverAgentTerminal(options = {}) {
  const runtimeRoot = options.runtimeRoot || getRuntimeRoot();
  const runtime = readConnectionInfo(runtimeRoot) || {};
  return buildAgentManifest({
    runtimeRoot,
    baseUrl: process.env.AGENT_TERMINAL_URL || runtime.baseUrl,
    token: process.env.AGENT_TERMINAL_TOKEN || runtime.token,
    includeToken: options.includeToken,
    activeSessionId: runtime.activeSessionId,
    sessions: runtime.sessions,
    updatedAt: runtime.updatedAt
  });
}

function buildAgentPrompt(manifest) {
  const baseUrl = manifest.baseUrl;
  const token = manifest.auth && manifest.auth.token ? manifest.auth.token : null;
  const activeSessionId = manifest.current && manifest.current.activeSessionId
    ? manifest.current.activeSessionId
    : 'none';

  // Everything the agent needs is baked in below, so pasting this is the whole
  // setup — it works from any machine that can reach the base URL.
  const auth = token ? `Authorization: Bearer ${token}` : 'Authorization: Bearer <token>';

  return `You can see and control my terminal sessions through the Agent Terminal API.
Everything you need is filled in below — no setup, no discovery step.

Connection:
  Base URL: ${baseUrl}
  Header:   ${auth}

How to use it (curl shown; use your normal HTTP client):
  # 1. List sessions and pick one:
  curl -s -H "${auth}" ${baseUrl}/sessions
  # 2. Read what is currently on a session's screen:
  curl -s -H "${auth}" ${baseUrl}/sessions/<id>/screen
  # 3. Run a shell command and get its output (use when the exit code matters):
  curl -s -X POST -H "${auth}" -H "Content-Type: application/json" \\
    -d '{"command":"ls -la"}' ${baseUrl}/sessions/<id>/run
  # 4. Type into an interactive app (Claude Code, Codex, editors, prompts):
  curl -s -X POST -H "${auth}" -H "Content-Type: application/json" \\
    -d '{"data":"hello"}' ${baseUrl}/sessions/<id>/input

Full list of endpoints: ${baseUrl}/openapi.json

Rules:
- List sessions first and use an exact session id; do not guess ids.
- Use /run for shell commands where the exit code matters; use /input to type into interactive apps.
- After sending input to an interactive app, re-read /screen to confirm it landed.

Current active session when this was copied: ${activeSessionId}`;
}

function schemaRef(name) {
  return { $ref: `#/components/schemas/${name}` };
}

function buildOpenApi(options = {}) {
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  const sessionId = {
    name: 'id',
    in: 'path',
    required: true,
    schema: { type: 'string' }
  };

  return {
    openapi: '3.1.0',
    info: {
      title: 'Agent Terminal Local API',
      version: pkg.version,
      description: 'Local loopback API for managing visible terminal sessions from coding agents.'
    },
    servers: [{ url: baseUrl }],
    security: [{ bearerAuth: [] }],
    paths: {
      '/health': {
        get: {
          summary: 'Health check',
          responses: { 200: { description: 'API status', content: jsonContent(schemaRef('AnyObject')) } }
        }
      },
      '/.well-known/agent-terminal.json': {
        get: {
          security: [],
          summary: 'Public agent discovery manifest',
          responses: { 200: { description: 'Agent Terminal manifest', content: jsonContent(schemaRef('AgentManifest')) } }
        }
      },
      '/agent-terminal/v1/manifest': {
        get: {
          security: [],
          summary: 'Public agent discovery manifest',
          responses: { 200: { description: 'Agent Terminal manifest', content: jsonContent(schemaRef('AgentManifest')) } }
        }
      },
      '/openapi.json': {
        get: {
          security: [],
          summary: 'OpenAPI contract',
          responses: { 200: { description: 'OpenAPI description', content: jsonContent(schemaRef('AnyObject')) } }
        }
      },
      '/control': {
        get: {
          summary: 'Read control state',
          responses: { 200: { description: 'Control state', content: jsonContent(schemaRef('AnyObject')) } }
        }
      },
      '/control/api-enabled': {
        post: {
          summary: 'Enable or disable local agent control',
          requestBody: jsonBody({ type: 'object', properties: { enabled: { type: 'boolean' } } }),
          responses: { 200: { description: 'Updated control state', content: jsonContent(schemaRef('AnyObject')) } }
        }
      },
      '/control/pause': {
        post: {
          summary: 'Pause agent writes',
          responses: { 200: { description: 'Updated control state', content: jsonContent(schemaRef('AnyObject')) } }
        }
      },
      '/control/resume': {
        post: {
          summary: 'Resume agent writes',
          responses: { 200: { description: 'Updated control state', content: jsonContent(schemaRef('AnyObject')) } }
        }
      },
      '/sessions': {
        get: {
          summary: 'List sessions',
          responses: { 200: { description: 'Session list', content: jsonContent(schemaRef('SessionList')) } }
        },
        post: {
          summary: 'Create a session',
          requestBody: jsonBody(schemaRef('CreateSessionRequest')),
          responses: { 201: { description: 'Created session', content: jsonContent(schemaRef('AnyObject')) } }
        }
      },
      '/sessions/{id}': {
        get: {
          summary: 'Inspect one session',
          parameters: [sessionId],
          responses: { 200: { description: 'Session metadata', content: jsonContent(schemaRef('AnyObject')) } }
        },
        delete: {
          summary: 'Delete one session',
          parameters: [sessionId],
          responses: { 200: { description: 'Delete result', content: jsonContent(schemaRef('AnyObject')) } }
        }
      },
      '/sessions/{id}/output': {
        get: {
          summary: 'Read raw output',
          parameters: [
            sessionId,
            { name: 'since', in: 'query', schema: { type: 'integer', minimum: 0 } }
          ],
          responses: { 200: { description: 'Output chunk', content: jsonContent(schemaRef('AnyObject')) } }
        }
      },
      '/sessions/{id}/screen': {
        get: {
          summary: 'Read clean current screen',
          parameters: [sessionId],
          responses: { 200: { description: 'Screen text', content: jsonContent(schemaRef('AnyObject')) } }
        }
      },
      '/sessions/{id}/state': {
        get: {
          summary: 'Read inferred state',
          parameters: [sessionId],
          responses: { 200: { description: 'Session state', content: jsonContent(schemaRef('AnyObject')) } }
        }
      },
      '/sessions/{id}/stream': {
        get: {
          summary: 'Stream session output with server-sent events',
          parameters: [
            sessionId,
            { name: 'since', in: 'query', schema: { type: 'integer', minimum: 0 } }
          ],
          responses: { 200: { description: 'Server-sent event stream' } }
        }
      },
      '/sessions/{id}/input': {
        post: {
          summary: 'Send terminal input',
          parameters: [sessionId],
          requestBody: jsonBody(schemaRef('InputRequest')),
          responses: { 200: { description: 'Input result', content: jsonContent(schemaRef('AnyObject')) } }
        }
      },
      '/sessions/{id}/run': {
        post: {
          summary: 'Run command with completion markers',
          parameters: [sessionId],
          requestBody: jsonBody(schemaRef('RunCommandRequest')),
          responses: { 200: { description: 'Command result', content: jsonContent(schemaRef('AnyObject')) } }
        }
      },
      '/sessions/{id}/launch': {
        post: {
          summary: 'Launch a coding-agent profile',
          parameters: [sessionId],
          requestBody: jsonBody(schemaRef('LaunchRequest')),
          responses: { 200: { description: 'Launch result', content: jsonContent(schemaRef('AnyObject')) } }
        }
      },
      '/sessions/{id}/interrupt': {
        post: {
          summary: 'Interrupt the session',
          parameters: [sessionId],
          responses: { 200: { description: 'Interrupt result', content: jsonContent(schemaRef('AnyObject')) } }
        }
      },
      '/sessions/{id}/restart': {
        post: {
          summary: 'Restart the terminal process',
          parameters: [sessionId],
          responses: { 200: { description: 'Restart result', content: jsonContent(schemaRef('AnyObject')) } }
        }
      },
      '/sessions/{id}/resize': {
        post: {
          summary: 'Resize the terminal',
          parameters: [sessionId],
          requestBody: jsonBody(schemaRef('ResizeRequest')),
          responses: { 200: { description: 'Resize result', content: jsonContent(schemaRef('AnyObject')) } }
        }
      },
      '/tasks': {
        get: {
          summary: 'List task records',
          responses: { 200: { description: 'Task list', content: jsonContent(schemaRef('AnyObject')) } }
        },
        post: {
          summary: 'Create a task record',
          requestBody: jsonBody(schemaRef('TaskRequest')),
          responses: { 201: { description: 'Created task', content: jsonContent(schemaRef('AnyObject')) } }
        }
      },
      '/tasks/{id}': {
        get: {
          summary: 'Read one task record',
          parameters: [sessionId],
          responses: { 200: { description: 'Task record', content: jsonContent(schemaRef('AnyObject')) } }
        }
      },
      '/tasks/{id}/checkpoints': {
        post: {
          summary: 'Append a task checkpoint',
          parameters: [sessionId],
          requestBody: jsonBody(schemaRef('AnyObject')),
          responses: { 200: { description: 'Updated task', content: jsonContent(schemaRef('AnyObject')) } }
        }
      }
    },
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer'
        }
      },
      schemas: {
        AnyObject: {
          type: 'object',
          additionalProperties: true
        },
        AgentManifest: {
          type: 'object',
          required: ['app', 'protocolVersion', 'baseUrl', 'capabilities', 'transports'],
          additionalProperties: true
        },
        SessionList: {
          type: 'object',
          properties: {
            activeSessionId: { type: ['string', 'null'] },
            sessions: { type: 'array', items: schemaRef('AnyObject') }
          },
          additionalProperties: true
        },
        CreateSessionRequest: {
          type: 'object',
          properties: {
            cwd: { type: 'string' },
            shell: { type: 'string' },
            cols: { type: 'integer' },
            rows: { type: 'integer' }
          }
        },
        InputRequest: {
          type: 'object',
          properties: {
            command: { type: 'string' },
            data: { type: 'string' },
            enter: { type: 'boolean' }
          }
        },
        RunCommandRequest: {
          type: 'object',
          required: ['command'],
          properties: {
            command: { type: 'string' },
            force: { type: 'boolean' }
          }
        },
        LaunchRequest: {
          type: 'object',
          required: ['profile'],
          properties: {
            profile: { type: 'string', enum: PROFILES.map((profile) => profile.name) }
          }
        },
        ResizeRequest: {
          type: 'object',
          properties: {
            cols: { type: 'integer', minimum: 20 },
            rows: { type: 'integer', minimum: 5 }
          }
        },
        TaskRequest: {
          type: 'object',
          properties: {
            objective: { type: 'string' },
            rules: { type: 'array', items: { type: 'string' } },
            cwd: { type: 'string' },
            profile: { type: 'string' },
            sessionId: { type: 'string' }
          }
        }
      }
    }
  };
}

function jsonContent(schema) {
  return {
    'application/json': {
      schema
    }
  };
}

function jsonBody(schema) {
  return {
    required: false,
    content: jsonContent(schema)
  };
}

module.exports = {
  PROTOCOL_VERSION,
  CAPABILITIES,
  ENDPOINTS,
  PROFILES,
  buildAgentManifest,
  buildAgentPrompt,
  buildMcpConfig,
  buildOpenApi,
  discoverAgentTerminal
};

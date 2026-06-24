# Agent Terminal

Agent Terminal is a local Mac terminal window that another local tool can supervise. You open the app, then Codex, Claude Code, or another agent can connect through the local API, read the clean screen state, run actions, and type into the visible terminal.

## Run it

```bash
npm install
npm start
```

The app starts a local control API on `127.0.0.1`. The API now requires a per-launch token. The helper CLI automatically loads the current URL and token from the app runtime file.

## Agent Discovery

In the app, press **Copy Agent Prompt** and paste it into any local coding agent.

Coding agents should start here instead of guessing ports, tokens, or session IDs:

```bash
./bin/agent-terminal.js discover --json
```

If an agent needs to call the local HTTP API directly:

```bash
./bin/agent-terminal.js discover --json --show-token
```

If an agent supports MCP:

```bash
./bin/agent-terminal.js mcp-config
```

The app also exposes local discovery documents:

```text
GET /.well-known/agent-terminal.json
GET /agent-terminal/v1/manifest
GET /openapi.json
```

See [docs/AGENT_INTEGRATION.md](docs/AGENT_INTEGRATION.md) for the stable agent contract.

## Core Workflow

```bash
./bin/agent-terminal.js list
./bin/agent-terminal.js screen <session-id>
./bin/agent-terminal.js state <session-id>
./bin/agent-terminal.js delete <session-id>
./bin/agent-terminal.js launch <session-id> claude-opus
./bin/agent-terminal.js send <session-id> "hello, claude"
```

Claude launch profiles avoid fragile model-menu navigation:

```bash
./bin/agent-terminal.js launch <session-id> claude-opus
./bin/agent-terminal.js launch <session-id> claude-plan
./bin/agent-terminal.js launch <session-id> codex
```

`claude-opus` runs:

```bash
claude --model opus --effort high
```

## Reliable Commands

Use `run` when the session is at a normal shell prompt and you need an exit code:

```bash
./bin/agent-terminal.js run <session-id> pwd
```

`run` wraps the command with markers and returns JSON containing `exitCode`, `output`, and `nextOffset`.

## Local Control And Pause

Agent-originated actions run directly on the local machine, with one guardrail:

- Obviously destructive commands are blocked.

Emergency controls:

```bash
./bin/agent-terminal.js pause
./bin/agent-terminal.js resume
./bin/agent-terminal.js disable-api
./bin/agent-terminal.js enable-api
```

The app UI also has pause and disable controls.

## Secure API

Every API request needs:

```text
Authorization: Bearer <token>
```

By default the app rejects non-loopback Host headers and rejects browser-origin requests from non-loopback origins. This prevents drive-by browser requests from typing into your terminal.

The copied **Copy Agent Prompt** has the URL and token baked in, so an agent can be on a different machine than the app — just paste it, no agent-side setup. If you run the app on a remote server, see [docs/REMOTE_ACCESS.md](docs/REMOTE_ACCESS.md) for the one-time server config.

Useful endpoints:

```text
GET  /.well-known/agent-terminal.json
GET  /agent-terminal/v1/manifest
GET  /openapi.json
GET  /sessions
POST /sessions
DELETE /sessions/:id
GET  /sessions/:id/screen
GET  /sessions/:id/state
POST /sessions/:id/input
POST /sessions/:id/run
POST /sessions/:id/launch
POST /sessions/:id/interrupt
POST /sessions/:id/restart
```

## MCP

The MCP bridge is available at:

```bash
./bin/agent-terminal-mcp.js
```

It exposes tools for listing, creating, and deleting sessions, launching agents, sending input, reading the screen/state, running commands, and pausing/resuming agent writes. It uses the same token-protected local API.

## Runtime Files

Runtime connection info, audit logs, and supervisor task files live under:

```text
~/Library/Application Support/Agent Terminal
```

The runtime connection file is written with user-only permissions. Audit logs are JSONL files in the `logs` folder.

## Verification

```bash
npm run check
npm test
npm audit --omit=dev
```

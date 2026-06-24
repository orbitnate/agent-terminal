# Agent Integration

Agent Terminal exposes the same local terminal-control surface through three agent-friendly paths:

- CLI: works for any coding agent that can run local commands.
- MCP: works for agents that support Model Context Protocol tools.
- HTTP/OpenAPI: works for agents that can call a local web API.

All terminal-control actions stay on `127.0.0.1` and require the per-launch token.

The simplest handoff is the app button: press **Copy Agent Prompt**, then paste that text into any local coding agent.

## Discovery

Use the helper first:

```bash
node bin/agent-terminal.js discover --json
```

That returns the current API URL, runtime file, MCP command, OpenAPI URL, capabilities, and current session list.

The token is hidden by default. If an agent needs to call HTTP directly:

```bash
node bin/agent-terminal.js discover --json --show-token
```

The app also exposes public local discovery routes:

```text
GET /.well-known/agent-terminal.json
GET /agent-terminal/v1/manifest
GET /openapi.json
```

These routes describe the contract but do not expose the token. Control routes still require authentication.

## MCP Setup

Generate a standard MCP server snippet:

```bash
node bin/agent-terminal.js mcp-config
```

The MCP server command is:

```bash
node bin/agent-terminal-mcp.js
```

MCP tools include discovery, session listing, session creation/deletion, launch, input, screen reads, raw output reads, state reads, run command, interrupt, restart, pause/resume, and enable/disable control.

## Session Workflow

1. List sessions.
2. Pick the exact session id.
3. Read `screen` and `state`.
4. Use the right input mode.
5. Re-read `screen` or `state` to confirm the terminal accepted the action.

Examples:

```bash
node bin/agent-terminal.js list
node bin/agent-terminal.js screen <session-id>
node bin/agent-terminal.js state <session-id>
```

Use this for shell commands:

```bash
node bin/agent-terminal.js run <session-id> "pwd"
```

Use this for interactive prompts:

```bash
node bin/agent-terminal.js write <session-id> "hello"
```

Use this to launch an agent inside a terminal:

```bash
node bin/agent-terminal.js launch <session-id> claude-opus
node bin/agent-terminal.js launch <session-id> codex
```

## HTTP Contract

Every control request needs:

```text
Authorization: Bearer <token>
```

Core endpoints:

```text
GET    /sessions
POST   /sessions
GET    /sessions/:id
DELETE /sessions/:id
GET    /sessions/:id/output
GET    /sessions/:id/screen
GET    /sessions/:id/state
GET    /sessions/:id/stream
POST   /sessions/:id/input
POST   /sessions/:id/run
POST   /sessions/:id/launch
POST   /sessions/:id/interrupt
POST   /sessions/:id/restart
POST   /sessions/:id/resize
```

For a complete machine-readable map, read:

```text
GET /openapi.json
```

## Input Rules

Use `run` when the terminal is at a shell prompt and the agent needs output plus an exit code.

Use raw input when the terminal is running an interactive app, such as Claude Code, Codex, a text editor, or a prompt-based UI.

For Claude Code specifically, after sending prompt text, re-check the screen to make sure the text was actually submitted and Claude started responding.

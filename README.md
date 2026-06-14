# Agent Terminal

Agent Terminal is a local Mac terminal window that another local tool can supervise safely. You open the app, then Codex, Claude Code, or another agent can connect through the local API, read the clean screen state, request actions, and type into the visible terminal under policy controls.

## Run it

```bash
npm install
npm start
```

The app starts a local control API on `127.0.0.1`. The API now requires a per-launch token. The helper CLI automatically loads the current URL and token from the app runtime file.

## Core Workflow

```bash
./bin/agent-terminal.js list
./bin/agent-terminal.js screen <session-id>
./bin/agent-terminal.js state <session-id>
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

## Approval And Pause

Agent-originated actions are checked against a policy:

- Read-only commands such as `pwd`, `ls`, `rg`, `cat`, `sed`, `git status`, and test/check commands are allowed.
- File writes, installs, pushes, commits, shell scripts, and unknown commands require approval.
- Obviously destructive commands are blocked.

Approval commands:

```bash
./bin/agent-terminal.js approvals
./bin/agent-terminal.js approve <approval-id>
./bin/agent-terminal.js deny <approval-id>
```

Emergency controls:

```bash
./bin/agent-terminal.js pause
./bin/agent-terminal.js resume
./bin/agent-terminal.js disable-api
./bin/agent-terminal.js enable-api
```

The app UI also has pause, disable, approve, and deny controls.

## Secure API

Every API request needs:

```text
Authorization: Bearer <token>
```

The app rejects non-loopback Host headers and rejects browser-origin requests from non-loopback origins. This prevents drive-by browser requests from typing into your terminal.

Useful endpoints:

```text
GET  /sessions
POST /sessions
GET  /sessions/:id/screen
GET  /sessions/:id/state
POST /sessions/:id/input
POST /sessions/:id/run
POST /sessions/:id/launch
POST /sessions/:id/interrupt
POST /sessions/:id/restart
GET  /approvals
POST /approvals/:id/approve
POST /approvals/:id/deny
```

## MCP

The MCP bridge is available at:

```bash
./bin/agent-terminal-mcp.js
```

It exposes tools for listing sessions, creating sessions, launching agents, sending input, reading the screen/state, running commands, approving queued actions, and pausing/resuming agent writes. It uses the same token-protected local API.

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

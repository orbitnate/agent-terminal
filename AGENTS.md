# Agent Instructions

## Communication

- Explain work in plain language.
- Keep updates short and practical.
- Avoid long logs or code dumps unless Nathan asks for them.
- Summarize problems as what went wrong, why it matters, and what happens next.
- End with what changed, whether it worked, and anything Nathan needs to do.

## Using Agent Terminal

Agent Terminal is meant to be a shared local control surface for coding agents.
Do not assume a hard-coded session, token, or port.

Start with discovery:

```bash
node bin/agent-terminal.js discover --json
```

If the agent needs a raw HTTP token, use:

```bash
node bin/agent-terminal.js discover --json --show-token
```

If the agent supports MCP, use:

```bash
node bin/agent-terminal.js mcp-config
```

Basic workflow:

```bash
node bin/agent-terminal.js list
node bin/agent-terminal.js screen <session-id>
node bin/agent-terminal.js state <session-id>
node bin/agent-terminal.js run <session-id> pwd
node bin/agent-terminal.js write <session-id> "text for an interactive prompt"
```

Use `run` for normal shell commands where an exit code matters.
Use `write` or MCP `send_input` with `data` for interactive apps such as Claude Code.
Always work against the exact session id shown by `list`.


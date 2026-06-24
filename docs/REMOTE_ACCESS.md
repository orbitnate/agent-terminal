# Remote access

**For the person using a coding agent, there is no setup.** Click **Copy Agent
Prompt** and paste it into your agent. The prompt has the URL and token baked in,
so it works from any machine that can reach the app — your agent can be at home
while the app runs on a cloud box.

The rest of this page is for whoever **deploys** the app on a remote server. It is
a one-time thing; end users never touch it.

---

## Running the app on a remote server

By default the app only listens on `127.0.0.1`. To make it reachable by a remote
agent, set these once when you launch it on the server:

```
# A strong, stable secret (>= 16 chars). The copied prompt embeds it for the agent.
export AGENT_TERMINAL_TOKEN="$(openssl rand -base64 32)"

# How the server is reachable from the outside — this is what the copied prompt uses.
export AGENT_TERMINAL_PUBLIC_URL="https://your-server.example:9876"

# Bind so the server actually accepts remote connections.
export AGENT_TERMINAL_HOST="0.0.0.0"
export AGENT_TERMINAL_ALLOWED_HOSTS="your-server.example"
```

That's the whole server-side setup. From then on the user flow is just **Copy
Agent Prompt → paste**.

If you bind beyond loopback without a strong token, the app refuses to start —
that guardrail is intentional, because the API can run shell commands.

### Don't have a public hostname? Use a private network (recommended)

The simplest secure option is [Tailscale](https://tailscale.com): install it on
the server and on the agent's machine (same account), then point
`AGENT_TERMINAL_PUBLIC_URL` / `AGENT_TERMINAL_HOST` / `AGENT_TERMINAL_ALLOWED_HOSTS`
at the server's tailnet name (e.g. `box.tailnet.ts.net`). No public ports, no
firewall holes, encrypted end to end. `tailscale serve` can also front it with
automatic HTTPS.

---

## Security notes

- The token in the copied prompt grants shell access through the API. Treat it
  like a password: don't commit it, rotate it if it leaks.
- Prefer HTTPS (a private Tailscale name, `tailscale serve`, or a TLS reverse
  proxy) so the token isn't sent in plaintext over the internet.

## Configuration reference

| Variable | Default | Purpose |
| --- | --- | --- |
| `AGENT_TERMINAL_TOKEN` | random per launch | Auth secret baked into the copied prompt. Required (>= 16 chars) for any non-loopback bind. |
| `AGENT_TERMINAL_PUBLIC_URL` | derived from host/port | The reachable base URL the copied prompt advertises. |
| `AGENT_TERMINAL_HOST` | `127.0.0.1` | Interface the API binds to. |
| `AGENT_TERMINAL_ALLOWED_HOSTS` | _(none)_ | Comma-separated hostnames/IPs allowed in the `Host`/`Origin` header beyond loopback. |
| `AGENT_TERMINAL_PORT` | `9876` | Preferred port (falls back to a random free port). |

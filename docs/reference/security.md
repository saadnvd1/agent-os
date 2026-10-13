# Security

AgentOS gives whoever uses it a terminal as you, so it decides who that is:

- **This machine** (localhost) is always trusted.
- **Your tailnet** is trusted by default. Turn on "Require pairing on Tailscale
  too" in Devices if other people share it.
- **Everything else** needs a paired device. That covers Wi-Fi, `AGENTOS_BIND`,
  and any reverse proxy, including `tailscale serve`. A request that arrives
  from localhost with proxy headers (`X-Forwarded-*`, `Forwarded`, `Via`,
  `X-Real-IP`, `CF-*`, `Tailscale-*` and similar) counts as coming from the
  proxy's client, not from this machine. A proxy that sends none of these
  looks like this machine itself, so put such a proxy behind
  `AGENTOS_AUTH=off` only if it does its own login.
- A request from localhost must also be addressed to `localhost` or
  `127.0.0.1`. This stops a web page that has rebound its own domain to
  127.0.0.1 from counting as this machine.

Each paired device holds its own token. Only a hash of it is stored, and
removing the device in Devices cuts its open terminals at once. A paired
device can use AgentOS but can't add devices or change access; only this
machine and the tailnet can.

AgentOS also refuses requests addressed to any other host name (DNS rebinding),
and API calls or terminal connections made by another website's page. That
Origin check holds whatever `AGENTOS_BIND` says: a page may write to the API
or open a terminal, chat or status socket only from this machine's own
addresses (loopback, the addresses it listens on, its tailnet name, its own
Connect address and `AGENTOS_ALLOWED_HOSTS`). Another Connect machine's page
is always refused. With `AGENTOS_BIND=0.0.0.0`, reaching it by a DNS name
other than these needs that name in `AGENTOS_ALLOWED_HOSTS`.

| Variable                               | Effect                                                                                                 |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `AGENTOS_NETWORK=lan`                  | Listen on Wi-Fi too. Same as the switch in Devices.                                                    |
| `AGENTOS_REQUIRE_PAIRING_ON_TAILNET=1` | Pairing on the tailnet too.                                                                            |
| `AGENTOS_BIND`                         | Listen on these addresses instead (e.g. `0.0.0.0`). Pairing still applies.                             |
| `AGENTOS_ALLOWED_HOSTS`                | Extra host names to answer to.                                                                         |
| `AGENTOS_TOKEN`                        | A device token for `aos` and the MCP server when they reach AgentOS over a network that needs pairing. |
| `AGENTOS_AUTH=off`                     | No pairing, for when your own proxy does the login. Anyone who reaches the port gets a shell.          |

## Connect

Connect (in development) reaches this machine from anywhere at
`https://m-<16 hex>.runagentos.com`. `agent-os connect` links the machine with
a code from runagentos.com: it makes an Ed25519 key in `~/.agent-os/connect`
that never leaves the machine, and the Connect service makes the machine a
Cloudflare tunnel. Running it again on a linked machine links the same tunnel
again, keeping its address. The first-run setup's Devices step can link too: paste
the code into the field (same code path, `POST /api/devices/connect`, local or
tailnet callers only). `agent-os disconnect` (or the switch in Devices)
turns it off.

While Connect is on, the production server:

- downloads cloudflared 2026.10.0 into `~/.agent-os/connect/bin` (never one
  from `PATH`) and checks its SHA-256 before making it executable or running it;
- asks the Connect service for a fresh connector token on every start and hands
  it to `cloudflared tunnel run` in `TUNNEL_TOKEN` only, never in argv, a file
  or a log;
- starts cloudflared only once AgentOS holds the tunnel port and has seen a
  connection to it arrive on its own listener, and stops it if the listener
  goes, so it never publishes something else on that port;
- runs cloudflared in a process group of its own under a small watchdog that
  kills it the moment AgentOS exits, however it exits, and kills one a crash
  left behind (from `cloudflared.pid`) before starting another;
- restarts cloudflared with backoff if it exits, and stops it when Connect is
  turned off. Devices shows its state.

Cloudflare's edge ends TLS and cloudflared delivers requests to a listener of
their own on `127.0.0.1:<port + 433>`. That listener never trusts anything as
this machine, the tailnet or `AGENTOS_AUTH=off`: every request needs a paired
device. It answers only the machine's own host name and drops
`X-Forwarded-Host`, `Forwarded` and `X-Original-Host` before anything reads
them.

| Variable               | Effect                                                              |
| ---------------------- | ------------------------------------------------------------------- |
| `AGENTOS_CONNECT=0`    | Never start Connect in this process.                                |
| `AGENTOS_CONNECT_PORT` | The tunnel's loopback port (default AgentOS's port + 433).          |
| `AGENTOS_CONNECT_DIR`  | Where the key and cloudflared live (default `~/.agent-os/connect`). |

## Demo mode

`AGENTOS_DEMO=1` runs a server that is safe to show to strangers, over fake
data. Every request is refused unless it is on a read allowlist
(`lib/security/demo.ts`): no terminals, no exec or send-keys, no git, tmux or
file writes, nothing that starts a session, task, dev server or other process.
Reads of sessions, chats, diffs and PRs work, as does pairing a device from
this machine. A few writes stay database-only: pinning a session, Done
(archives, with no merge or clean-up), answering an ask, and removing your own
device. A chat message gets a short canned reply instead of an agent, and the
device list and network settings show no addresses. Visitors share one demo,
so what they type (a chat message, an answer to an ask) is kept and shown as
fixed text, and the database goes back to its seed every 10 minutes, in
place, while it keeps serving.
File reads stay inside the demo's home, and the server refuses to start in
demo mode unless `HOME` and `DB_PATH` both sit under `AGENTOS_DEMO_ROOT`, so
it can never serve a real machine's sessions.

```bash
npm run demo                  # seed fake data, serve it on 127.0.0.1:3340
npm run build && npm run demo -- --prod
AGENTOS_BIND=0.0.0.0 AGENTOS_ALLOWED_HOSTS=demo.example.com AGENTOS_AUTH=off npm run demo -- --prod
```

The seed (`scripts/screenshots/seed.ts`) needs git and tmux, and works on macOS
and Linux. `AGENTOS_DEMO_ROOT` (default `/tmp/agentos-demo`) and
`AGENTOS_DEMO_PORT` move it; keep the root short, as tmux socket paths are
limited to about 100 characters.

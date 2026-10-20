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

"Can approve" lets a paired device answer the orchestrator's asks, pause
it, and turn Away on or off, including over Connect. A device paired from
the AgentOS app gets it at pairing: the app asks for its token in the reply
and sends no Origin header, which a browser page can't do. It held the same
one-time code a browser would, so this trusts it no further than pairing
already did. A device paired from a browser starts without it. Devices
paired from the app before this got it once, on upgrade; devices that
weren't, or that were removed, didn't. You can turn it off for any device in
Devices, and it stays off. Approvals that matter still need a passkey.

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

### Linked machines over Connect (in development)

Two machines on the same Connect account will be able to link without a
tailnet (`lib/peer`; pairing is not built yet, so nothing creates a link
today). A link stores the other machine's public keys, never a token. Each
call is `POST /api/peer/rpc` carrying an envelope signed with the caller's
Ed25519 machine key and encrypted (X25519, HKDF-SHA256, ChaCha20-Poly1305) to
the other machine's box key, `~/.agent-os/connect/peer.key`, which never goes
to the Connect service. The envelope names both machines and carries a
timestamp (±120 s) and a nonce remembered for that window, so a captured call
can't be replayed here or on another machine. Nonces are kept in SQLite until
their timestamp is stale, so a restart doesn't reopen that window. While no
link is active the route refuses everyone before reading a byte. The header
carries its own signature, checked before any of the body is held: until it
verifies, bytes count only against the source address, in a small pool apart
from what linked machines get, so a forger can't use up a real sender's share.
An unknown sender, a suspended link and a bad signature are checked the same
way (against a decoy key) and get the same refusal. A body must keep up a
minimum rate over each few-second window, so a burst can't bank time. The answer is sealed with a fresh IV and
signed, and only opens for the request it answers. Cloudflare sees that a POST
happened, its size and its timing, not the route or the status.

A verified call is checked against an allowlist (`lib/peer/allowlist.ts`: the
task, session, project, load and sweep routes the peer code uses) and re-issued
to this machine's own loopback listener with a per-boot secret. The gate turns
that secret into `peer` trust, refuses it from anywhere else (and outright on
the tunnel listener), and refuses `peer` on any route off the allowlist and on
every WebSocket. `peer` never passes the local-only guard and is never an
approver. Calls are recorded in `peer_audit` on both sides: successful reads
fold into one row per route per hour, and failed or refused calls are capped
per minute, with refusals anyone could cause apart from the rest, so a flood
of forged envelopes can't fill the disk or hide this machine's own failures. An unsigned
refusal of a write is treated as an unknown outcome, since anyone on the path
could forge one.

### Shared links

A chat or page can be shared as a read-only snapshot through Connect
(`docs/guides/sharing.md`). Redaction and rendering run on this machine: the
snapshot builder masks secrets (the orchestrator's token and assignment rules,
private-key blocks, bearer tokens, URL credentials, secret query parameters,
and the values of secret-looking environment variables), the home folder, IP
addresses, this machine's names and `*.ts.net` names, and email addresses, and
leaves tool calls and thinking out unless asked. A tool that read a secret
file (`lib/secret-paths.ts`) has its output replaced. The Markdown version
uploaded with every share is rendered from that same redacted snapshot and
is covered by the same hash check.

`POST /api/shares/preview` is local only. `POST /api/shares` renders the page
again from the same inputs, requires its SHA-256 to match the preview's, and
only then sends it, signed with the machine key like every other Connect call;
markup from the browser is never uploaded. Connect stores the page and a
digest of the link's token, and serves it with a CSP `sandbox` that omits
`allow-same-origin`, so a script in it runs in an opaque origin and cannot read
runagentos.com cookies or storage. Because Connect keeps no copy of the link,
the full URL is kept only in this machine's `shared_links` table. The routes
refuse in demo mode and cap their request bodies.

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

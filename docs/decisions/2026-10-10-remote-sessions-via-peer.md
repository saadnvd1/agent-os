# Sessions on a linked machine go through its own AgentOS

Date: 2026-10-10

## Decision

A session on a linked machine (one paired with **Link** in Machines) opens on
this machine exactly like a local one, terminal and chat, by talking to the
AgentOS running on that machine. That AgentOS owns the session: its tmux, its
chat worker, its state. This machine is a client of it. ssh stays only as the
route for machines that are not linked.

## What t3code does

t3code (pingdotgg/t3code, `docs/internals/remote.md`,
`docs/user/remote-access.md` and the client runtime) models each machine as
an **environment**: a server that owns execution, files, terminals, agents and
durable state. Clients only ever talk to it over authenticated RPC, the local
desktop app included.

- **Client registry.** It keeps one entry per environment, keyed by a stable
  environment id. Each entry has an ordered list of routes and no credential;
  credentials live in a separate store. It holds one supervised RPC session
  per environment.
- **Chat as structured events.** Threads stream as typed events, not as a
  PTY. A subscription gets a snapshot, then a `synchronized` marker, then
  numbered events. A resubscribe with `afterSequence` replays only what it
  missed.
- **Terminals over the same socket.** Terminals are RPC calls on that one
  socket: `terminal.open`, `attach`, `write`, `resize` and `close`, with
  client-chosen terminal ids. `attach` sends a snapshot of the history, then
  live output chunks.
- **Auth.** Pairing is one-time and scoped. Bearer and DPoP clients swap
  their token for a short-lived WebSocket ticket, so long-lived tokens never
  appear in a socket URL. Each RPC declares the scope it needs.
- **Reconnect.** A supervisor backs off from 1 s up to 300 s with jitter and
  replaces the session. Subscriptions follow the new session and resume from
  their cursor. Mutations are never replayed.
- **Routes.** Each environment has an ordered list of addresses (LAN,
  Tailscale, public URL, SSH forward, relay). The first one that answers wins.
  Each address is checked against the environment's identity before any
  credential is sent to it. Earlier routes are re-tried in the background.
- **SSH is only a route.** SSH starts the server and forwards a port. The
  normal HTTP/WebSocket protocol runs over that forward, so execution never
  happens over ssh.

## What we copy

- **The ownership model.** The machine that runs a session is the authority
  on it. Its tmux sessions, its managed sessions and their statuses come from
  its AgentOS (`/api/tmux/discover`, `/api/sessions`, `/api/sessions/status`).
  Its terminals and chats are served by its own `/ws/terminal` and `/ws/chat`.
  Nothing is run over ssh for a linked machine, and its screens are never
  captured over ssh.
- **SSH as a route, not an execution model.** For a linked machine, ssh is
  used once, to fetch a pairing code at link time (as before). Machines that
  aren't linked keep the ssh path unchanged as the fallback.
- **Snapshot, then live, on every (re)subscribe.** AgentOS's chat socket
  already sends a snapshot and then items, and its shared terminal attach
  already replays the screen from a reset on join. A reconnect anywhere in
  the chain is a fresh subscribe that takes a snapshot, which is t3code's
  model without its sequence cursor.
- **Backoff reconnect for terminals.** A dropped peer connection retries at
  1, 2, 4, 8 and then 15 seconds, and gives up and says so after two minutes.
  A refused token (401/403) or a session that detached ends it at once. So
  does a peer that was never reachable, so a click on a machine that's down
  answers in seconds.
- **Credentials out of URLs.** The link's device token goes only in the
  `Authorization` header of the HTTP call or WebSocket upgrade, never in the
  query string, and never reaches the browser. No Origin is sent, so the
  peer's Host/Origin checks see what they see for `aos` or curl.
- **Sessions keyed by machine and name** (t3code: everything is scoped to its
  environment id). The status detector, discovery, the managed-pane match and
  the shared terminal attach all key by `host + name`, so a "main" on the box
  no longer hides a "main" here.

## What we do differently, and why

- **The server relays, the browser doesn't connect to the peer.** In t3code
  the client connects to each environment directly. Here the browser (often a
  phone) talks only to this machine's AgentOS, and that server opens the
  connection to the peer. There are three reasons:
  1. The browser may not be able to reach the peer at all. The box is not
     reachable from everywhere the phone is.
  2. The device token would have to be handed to the browser.
  3. The box must never need to reach the Mac, and it never does: every
     connection starts here.
- **One upstream socket per stream, not one multiplexed socket per machine.**
  AgentOS's peer protocol is already one socket per terminal and one per chat.
  Multiplexing would mean new endpoints and a new protocol on both sides, for
  little gain at this scale. The terminal side is deduplicated anyway: the
  shared attach here holds one upstream connection per session, however many
  views show it. The peer's PTY stands in as the shared attach's pty
  (`PeerPty`), so flow control carries through. The relay acks the peer only
  while views here keep up, so a slow phone here slows tmux there.
- **No sequence cursor or replay-since.** AgentOS's chat and terminal sockets
  have no event sequence numbers. A reconnect takes a full snapshot, which a
  chat page already does. Adding cursors is a protocol change on both sides,
  and is left out.
- **No multi-route selection or identity check per route.** A link stores one
  URL, and linking already refuses an address that isn't the machine's own
  ssh host. The token only ever goes to that stored URL. Multiple routes and
  learned addresses are a follow-up, not needed for one box on a tailnet.
- **No new auth scheme or short-lived tickets.** The constraint was to reuse
  the link's device token. The peer's existing gate already accepts it as a
  Bearer header on WebSocket upgrades, so no ticket exchange is needed to keep
  it out of URLs.
- **Agent and schedule messages aren't relayed to a peer's chat.** The chat
  view relays what the user types. A server-side send to a linked machine's
  chat, from `aos send` or a schedule, is still refused, with a message saying
  why. Such a message would reach the peer as an ordinary client send, which
  it attributes to the user, so another agent's text would read as the user's
  own. Unlinked machines keep the old refusal, now with a pointer to linking.
- **Opening a peer-managed session mirrors it.** AgentOS's UI opens sessions
  that have a row, so opening one creates a mirror row here, as moved and
  remote tasks already do: the same id, the peer's host id, and the peer's
  own name, folder, view and agent type, re-read from the peer and never
  taken from the click. The row is only how this machine shows the session;
  deleting it deletes nothing on the peer.

## Follow-ups (not in this change)

- **The peer should build its own launch command.** The launch command for a
  mirrored terminal session is still built on this machine and sent as the
  attach `command` (the old ssh path did the same). It only matters when the
  tmux session is gone. The peer should rebuild it from its own row.
- **Live state should be pushed.** Peer statuses are polled with the status
  pass, at most every 5 s per machine. Subscribing to the peer's `/ws/status`
  would push them instead.

## Later: linked machines' sessions are sessions here

Every session a linked machine's AgentOS lists is mirrored as soon as it is
listed, not on first open (`lib/hosts/peer-sync.ts`). So it gets the same row,
menu and address as a local one. It sits with its project when its folder
maps to a project on that machine, and otherwise under the machine's name.
"Elsewhere" is left for tmux sessions no AgentOS started. A mirror the peer
listed and then stopped listing goes. Rename, delete, done and undo run on the
peer with the link's token (`lib/hosts/peer-actions.ts`). Done refuses anything
that is a task there, so it never merges. Fork, fresh start, move to project
and check-ins are shown disabled, with the reason
(`lib/hosts/remote-menu.ts`). Task mirrors keep their own paths.

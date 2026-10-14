# Share links

**Decision.** A chat or a page is shared as a read-only snapshot that this
machine redacts and renders, uploads to Connect, and gets back a link.
Connect stores and serves it; it never sees the raw transcript.

**Why.** People want to show a conversation without giving access to the
machine. Doing redaction here means the one party that can be trusted with the
raw text is the only one that reads it, and a preview shows what leaves.

**Calls made.**

- **Serving.** Same host as the rest of Connect, with a CSP `sandbox` that
  leaves out `allow-same-origin`. The page runs in an opaque origin, so
  scripts in a shared artifact can't touch runagentos.com cookies or storage,
  and the session cookie is already host-only. A separate user-content domain
  would add protection against a domain-wide blocklist; it costs a purchase,
  so it is parked in ideas.md for the owner to decide.
- **Re-render and hash, not client HTML.** The create route builds the page
  again from the same inputs and requires its hash to equal the preview's. The
  upload is provably what was shown, and a client can't push arbitrary markup
  through this route.
- **The link is stored only here.** Connect keeps a digest of the token, so a
  lost link can't be recovered there. `shared_links` holds the URL for
  copying again, and Connect's own list can still revoke.
- **Thinking goes with tool calls.** Both are off by default under one switch;
  thinking leaks the same things tool output does.
- **Which hostnames are masked.** This machine's names, `*.ts.net`, `.local`,
  `.lan`, `.internal`, `.home.arpa`, the Connect machine name and ssh-config
  hosts. Public domains stay: masking all of them would wreck ordinary content.
- **Any paired device may share**, not only loopback or the tailnet. A device
  that can read the transcript is no more exposed by sharing it. Demo mode
  refuses.
- **Dropped messages are a deny-list.** The dialog sends the ids it dropped;
  anything that arrives later is caught by the hash check.

**Not done here.** Live-updating links, comments, passwords or viewer
accounts, sharing from the native app, Mermaid in snapshots (they render as
code), and a separate user-content domain.

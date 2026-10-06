# LumifyHub integration

AgentOS works fully without a LumifyHub account. Connecting one adds team
features: a workspace's docs and boards live in LumifyHub, where they can be
shared and worked on together.

## What maps to what

| AgentOS | LumifyHub | Direction |
|---|---|---|
| Workspace | Workspace (1-to-1) | linked once, by the user |
| Project | Board in that workspace | linked once, by the user |
| Task | Card on the project's board | AgentOS creates and moves it |
| Card in the board's first list | Task, on "Run" | the user starts it from AgentOS |
| Docs tab | Pages in the workspace | read in AgentOS, edited in LumifyHub |
| Repo markdown file | Page marked "from repo" | one way, on "Publish" |

Code docs (CLAUDE.md, READMEs, decision records) stay in git. Team docs
(specs, plans, notes) live in LumifyHub. Nothing syncs both ways.

A task's card moves through the board's lists as the task runs:

| Task state | List |
|---|---|
| queued | To Do |
| running | In Progress |
| PR open / awaiting sign-off | In Review |
| merged | Done |
| failed or dropped | stays where it is, with a comment |

AgentOS creates any of the four lists the board is missing. The PR link is
added to the card as a comment.

## Docs and publishing

The Docs tab lists the linked workspace's document pages (boards, databases
and whiteboards aren't documents and don't appear) and renders each page's
markdown. "Open in LumifyHub" is where a page is edited.

Publishing a repo markdown file creates a page titled by the file's first H1
(dropped from the body when it opens the file) or its name, with one line on
top saying where it comes from and that edits in LumifyHub are overwritten.
AgentOS remembers the file's page and a hash of what it sent:

- publishing again updates that page (or creates a new one if it was deleted);
- signing off a task re-publishes the project's published files whose merged
  content (read from the base branch after the merge) changed.

LumifyHub stores markdown only when it survives a round trip unchanged, so a
file it can't reproduce exactly is refused with its reason.

Agents use `aos docs`, `aos doc <id>` and `aos doc new` through AgentOS's own
`/api/bus/docs` endpoints, scoped to the linked workspace of the session's
project; the token never reaches the agent.

## Connecting

AgentOS is self-hosted, so it can't hold a client secret. It connects with an
authorization code and PKCE (S256); the code is useless without the verifier
that only the AgentOS instance that started the flow holds.

1. AgentOS sends the browser to

   ```
   GET {base}/connect/agentos
     ?redirect_uri={agentos origin}/api/lumifyhub/callback
     &state={random}
     &code_challenge={base64url(sha256(verifier))}
     &code_challenge_method=S256
     &client_name=AgentOS on {machine}
   ```

2. LumifyHub asks the user to log in or sign up (returning to the same URL
   afterwards), then shows an approve page naming `client_name` and the
   redirect host. Approve redirects to
   `{redirect_uri}?code={code}&state={state}`; Deny redirects to
   `{redirect_uri}?error=access_denied&state={state}`.

   - `redirect_uri` must be http or https and its path must end in
     `/api/lumifyhub/callback`.
   - The code is single use and expires after 5 minutes.

3. AgentOS exchanges the code:

   ```
   POST {base}/api/cli/connect/token
   { "code": "...", "code_verifier": "...", "redirect_uri": "..." }
   → 200 { "token": "lhcli_...", "user": { "id", "email", "name" } }
   → 400 { "error": "invalid_grant" }   (unknown, used, expired, wrong
                                          verifier or redirect_uri)
   ```

   The token is an ordinary CLI token named after `client_name`, so it shows
   up, and can be revoked, in the account's CLI tokens settings.

Until LumifyHub serves `/connect/agentos`, the connect dialog also takes a
pasted CLI token (Account settings → CLI).

`AGENTOS_LUMIFYHUB_URL` points AgentOS at another LumifyHub (a self-hosted
one, or a development server); it defaults to `https://lumifyhub.io`.

## API used

Everything after connecting is the existing token API under `/api/cli/*`
(`Authorization: Bearer lhcli_...`): workspaces (list, create), boards, lists
and cards (CRUD, comments), and pages (list, show, create, update; markdown in
`content`). Members and invites stay in LumifyHub; AgentOS links to them.

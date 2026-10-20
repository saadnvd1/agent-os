# Machines

Link another machine that runs AgentOS and its sessions show up next to
yours, with the same rows, menu and address. Their chats and terminals are
relayed through this server. Pick the machine on a draft to start a session
or task there, even for a project that only lives here (it finds or clones
the repository), and move a running terminal task between machines.

![A linked machine's sessions listed under its name in the sidebar](../../screenshots/machines.png)

Open the sidebar menu (⋯) → **Machines** and add one with a name and an ssh
target (`user@host` or an alias from `~/.ssh/config`). Requirements: key-based
ssh from the machine running AgentOS (no password prompts), and tmux on the
remote machine. **Test connection** checks both.

New projects can then pick a machine. Their sessions run in tmux there and
attach over one reused ssh connection per machine. Folders match across
machines relative to `~`, so `~/dev/app` on your laptop and on a server are
the same project.

On other machines, files, git, worktrees, dev servers and summarize are not
available yet; the terminal, status, rename and send-keys are.

## Sessions on a linked machine

Once a machine is linked (below), this AgentOS talks to the AgentOS running
there instead of running tmux over ssh. That machine owns its sessions: their
processes, chats and state. This one is a client of it, over HTTP and
WebSockets with the link's device token, and only ever connects out to it.

- The sessions its AgentOS runs are sessions here: each is mirrored (same id)
  as soon as it's listed, with the same row, menu and address as a local one.
  One whose folder is in a project you have for that machine sits with that
  project's sessions; the rest are listed under the machine's name. Its
  orchestrator and its tasks stay with it. **Elsewhere** is only for tmux
  sessions no AgentOS started.
- From the menu, rename, done (and its undo) and delete run on that machine.
  Fork, fresh start, move to project and check-ins are shown disabled with
  the reason. A new session started here on that machine is started by its
  AgentOS and opens in chat, like a local one.
- A session for a project here can start on a linked machine too: pick it in
  the draft's Machine chip. That machine finds the project by its repository
  or folder, or clones it, as for tasks. A machine that can't (no remote, a
  folder there that isn't a repository, no clone access, unreachable) is
  greyed out in the chip with the reason. The session sits with the project
  here.
- Starts are safe to retry: the draft's id is the start's key and the
  session's id, so a resend, or this machine retrying a start whose answer
  was lost, gets the session the first one made instead of a second.
- Terminals attach through its `/ws/terminal`, relayed by this server; one
  connection per session however many views show it, with flow control
  carried through. A dropped connection retries for two minutes, then says so.
- Chats open in the chat view through its `/ws/chat`, retried the same way
  while the chat stays open. Messages from agents
  (`aos send`) and schedules aren't relayed to another machine's chats: they'd
  arrive there as yours.
- The orchestrator asks that machine for a linked task's screen before
  clearing it; a screen it can't get counts as possibly blocked.
- ssh stays for machines that aren't linked. A row that can't be opened
  (the machine unreachable, a name tmux can't attach) is greyed out and says why.

## Tasks on another machine

A machine that runs its own AgentOS can take tasks. Run AgentOS there (any
port behind your own front door, or plain 3011 on loopback plus a proxy), then
press **Link** (the chain icon) next to it in Machines. Linking asks that
AgentOS for a pairing code over ssh, where its loopback is trusted, and keeps
the device token it gets back. The token goes straight into this machine's
database and is never shown.

Once linked:

- **New task → Run on** picks the machine (`aos task --on devbox <project> ...`
  does the same). That machine creates the worktree, runs the agent and opens
  the PR on its own. This one lists the task in the sidebar and Tasks with its
  live state, opens its chat (or terminal) through that machine's AgentOS,
  and sends sign-off and drop to it (pinned to the reviewed commit). Opened
  while it still sets up, it shows that machine's setup steps and joins the
  agent once it starts. Tasks open as chats unless Terminal is picked.
- **Move** carries a running task between this machine and a linked one,
  either way. The source stops the agent, commits anything uncommitted as
  `wip: moving to <machine>`, pushes the branch and hands over Claude's
  conversation. The target finds the project by its git remote, then by its
  folder relative to `~`, and clones it when it has neither. It checks the
  branch out (reusing a worktree still on it), rewrites the conversation's
  paths and resumes it with `--resume`. The source keeps its row, marked moved.
  If the target refuses, the agent resumes where it was. If the source can't
  tell whether it arrived (a timeout, a restart), the task stays **Moving**:
  press Move again to finish it, or **Resume here**, which first asks the
  other machine whether it arrived. Tasks waiting on you (an escalated gate or
  an open ask), card tasks and stacked tasks don't move yet.
- **An orchestrator's task moves too**, by the orchestrator's `move` tool (`task`,
  `machine`; `here` brings it back) or the Move button. Its state is re-keyed to
  the task's new session id in the same step it lands: brief and scope changes,
  plan file and phase, gate checks and failure counts, asks, wakes, queue
  order, arm, model and provider. Both machines need an AgentOS that can do
  it, and the arriving one must have the task's provider. The machine it lands
  on holds it for the orchestrator's machine alone: only that device can
  merge, arm, message, stop, done or read it, and the arriving machine's own
  orchestrator, armed merges and bulk done skip it. The orchestrator keeps
  judging the PR at its head, reads BLOCKED lines and open approvals from the
  task's chat there, and gets PR, CI, idle and plan events by polling that
  machine. Its messages arrive marked as from the orchestrator, never as
  yours. The task can `aos send` its orchestrator back: the machine it runs
  on only stores the message, and the orchestrator's machine pulls it and
  delivers it as that task's own. Moving it back stops its agent there and
  removes its worktree when nothing in it would be lost. Guards (write guard, shell deny list, attribution settings) run in
  the task's worker on either machine, and the task can't merge or push to
  the default branch. Moving counts toward the brakes and Pause refuses the
  tool.
- **A chat task moves the same way**, between turns: a running turn is let
  finish (up to 3 minutes, else the move is refused and it carries on here),
  and one waiting on your answer isn't moved. What's sent to it while its
  turn finishes waits in its queue and goes with it; once the move has packed
  the queue, sends are refused until it arrives. Its chat history, queue,
  access and plan settings go
  with it, and on arrival a chat worker resumes the same Claude conversation.
  Both machines need an AgentOS that can move chat tasks.

Works for any project. Requests to the other machine carry its device token,
so it can sit behind a proxy that never trusts loopback. Linking needs this
machine or the tailnet, and only pairs with the ssh target's own host name.
The orchestrator starts tasks on its own machine and moves them afterwards.

### Linking through AgentOS Connect

With AgentOS Connect Pro, Machines lists every machine on your account under
**On your AgentOS account**, online or not, with no ssh or tailnet needed.
Press **Link** next to one: this machine shows a 6-digit code, and the other
one shows a banner (and a row in its Machines) asking you to type it. Typing
it there needs that machine itself, its tailnet or a device with **Can
approve**. On a box with no browser, `agent-os link accept 482913` takes the
code; `agent-os link` lists the account's machines and what's waiting, and
`agent-os link <name>` starts a link from the terminal. Three wrong codes end
the request and a request lasts 5 minutes. Both machines then list each other
as linked, and you get a "New machine linked" push. **Unlink and remove**
(or `agent-os unlink <name>`) forgets the other machine here. Calls between
machines linked this way are still being wired up; until then tasks run on
machines linked over ssh. How it's kept safe: [Security](security.md).

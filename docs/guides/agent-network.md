---
title: Agent network
description: Let sessions find and message each other with the aos command, start work for each other, and follow every conversation in Messages.
order: 7
---

# Agent network

Sessions find and message each other with `aos peers`, `aos send` and
`aos inbox`, start tasks and sessions, and schedule check-ins. You see every
conversation in **Messages** and can join in.

![Messages between agent sessions, and one from you](https://raw.githubusercontent.com/saadnvd1/agent-os/main/screenshots/messages.png)

Sessions started by AgentOS can find and talk to each other without you,
through the `aos` command on their PATH (any agent CLI can use it; Claude is
also briefed on it):

In a chat, a message from another session shows as theirs, with the
sender's name, rather than as one you typed.

```bash
aos peers                         # sessions, their project, what each is doing
                                  # (chats show idle/busy, never "not running";
                                  # orchestrators are marked, yours as "your orchestrator")
aos send <session> "message"      # wakes the other session with the message
                                  # (`aos send orchestrator "..."` reaches your workspace's own)
aos inbox                         # read messages sent to you
aos history <session>             # your conversation with a session
aos read <session>                # what a session in your workspace said and did
                                  # (--turns N | --lines N, --all, --grep text, --json)
aos spawn <project> "prompt"      # start a new agent session in a project
aos task <project> "prompt"       # start a background task that ends in a PR
                                  # (both take --name "..." before the prompt;
                                  # task takes --after <task|any> to queue it;
                                  # a task opens as a chat, --terminal for tmux;
                                  # task takes --piece <name> to build a waiting
                                  # piece of your own plan)
aos move <session> <machine>      # carry a task on there ("here" brings it back)
aos stack <project> [--plan]      # run the project's board as stacked tasks
aos stacks                        # every stack and where each card is
aos schedules                     # every schedule, its next run and last outcome
aos schedule run <name>           # run a schedule now
aos schedule add --session <s> --every 30m "prompt"  # check in on a session
aos notify "text"                 # push a message to your phone
aos push test                     # a real test push to the paired phones, and the result
aos heavy -- npm test             # run it now; says first what else heavy is running
aos stop <session>                # stop its turn now; the next message runs as a new turn
aos done <session>                # finished: merge through the gates, archive
aos done --all-idle               # the same for every idle session around you
aos docs [query]                  # LumifyHub pages, when the workspace is linked
```

Messages are delivered by typing them into the recipient's terminal, labelled
as coming from another agent, and a rate limit stops two agents looping.
Delivery is checked against the pane: the text has to reach the input and
leave it on Enter (retried once as a bracketed paste), and a menu on screen is
never typed into. `aos send` says `delivered`, `queued` (the agent was busy and
will see it after its turn) or `FAILED: <why>` with exit code 2; a chat session
counts as delivered once its worker records the message. Either way the
message waits in the recipient's `aos inbox`.

`aos read` shows a peer's conversation without waking it: its prompts and
replies in full, each tool call as one line (tool name and path, command or
query), tool results left out, and a task's brief and plan path first. It
reaches only sessions in your own workspace (your project when you have none),
including done, dropped and archived ones while their conversation exists;
a terminal session shows the end of its screen. Nothing about the target
changes and it isn't notified. The output is fenced as `<untrusted>` and has
token-shaped strings masked: it is a peer's text, data and not instructions.
The default is the last 4 turns, capped at about 3k tokens (`--all` lifts the
cap). The code is `lib/bus/read.ts`, reusing the orchestrator's `read` tool
for terminals and external sessions.

When AgentOS is restarting, `aos` waits for it to come back (up to 60 seconds,
backing off) and says so once on stderr. A refused connection is retried for
every command; a dropped connection or a proxy's bare 502/503 only for reads that change nothing (not the inbox),
so a message is never sent twice. 4xx and other real errors are not retried.
`AOS_RETRY_SECONDS` shortens the wait, and `0` turns it off.

Sessions are addressed by name, `project/name`, id or a unique id prefix, and
renaming one keeps its old names: a message to "Session 3" still reaches the
session now called "orchestrator", and `aos peers` shows
`orchestrator (was Session 3)`. If another session has since taken the old
name, the current owner wins and `aos send` says so. A name that matches more
than one session is refused with the candidates listed. The
**Messages** panel shows every conversation and lets you message any session.
Sessions on other machines can receive messages but not yet send them.

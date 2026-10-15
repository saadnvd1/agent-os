# Architecture

Pictures of how AgentOS works: one overview of the systems and how they connect, and one page per system with a diagram of its flow or lifecycle, its key states, a few plain lines, its key files and the docs behind it. They are plain HTML files with their styles inline, readable in light and dark and on a phone.

Open [index.html](index.html) in a browser. GitHub shows HTML as source, so open the file from a checkout, or ask an agent in a chat to show it with `html_render` and it opens in that session's Artifacts panel (links between pages only work when the files are opened from disk).

| Page                                   | What it shows                                                            |
| -------------------------------------- | ------------------------------------------------------------------------ |
| [index.html](index.html)               | The systems and how they connect; every box links to its page            |
| [sessions.html](sessions.html)         | Chat workers, the message path, what a restart does, the status dot      |
| [tasks.html](tasks.html)               | A task from start to deploy, the queue's holds, score and placement      |
| [plans.html](plans.html)               | Plan first, pieces and their reasons, stacks                             |
| [gates.html](gates.html)               | The six merge gates, review, arm, sign off, land, auto-rebase            |
| [orchestrator.html](orchestrator.html) | Events and the watcher, tools, asks, brakes, away                        |
| [machines.html](machines.html)         | Linked machines, moving a task, queue placement                          |
| [deploy.html](deploy.html)             | Autodeploy: settle, restart gap, wait quiet; npm publish                 |
| [health.html](health.html)             | Detectors, watchers, machine load                                        |
| [schedules.html](schedules.html)       | Schedules, one-offs, recipes                                             |
| [bus.html](bus.html)                   | `aos send`, delivery into a chat or a pane, the command's families       |
| [workspaces.html](workspaces.html)     | Workspaces, Done and restore, session logs, orchestrator-to-orchestrator |
| [sharing.html](sharing.html)           | Share links: mask, preview, upload, expiry                               |
| [phone.html](phone.html)               | Who is trusted, pairing, Connect, push                                   |

## Keeping them true

A pull request that adds or changes a system updates its page here, and the index if it adds a system or a connection between systems. `scripts/architecture-docs.test.ts` fails when a link breaks, a key file named on a page no longer exists, a page loads anything from outside, the shared stylesheet block differs from the index's, or the merge gates on `gates.html` differ from the code's.

Each page has the same shape: a diagram (nodes numbered in order, so a wrapped row still reads in sequence), key states, plain words, key files, and links to [guides](../guides/README.md), [reference](../reference/README.md) and [decisions](../decisions). Draw only what the code does; check an arrow against the file before adding it. Keep machine names, addresses and people out: it is a public repository.

To change the shared look, edit the block between `arch:start` and `arch:end` in every file, identically.

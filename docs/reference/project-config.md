# Project config (`agentos.json`)

A project describes how its sessions run in `agentos.json` at the repository
root. Every field is optional:

```json
{
  "ports": { "RAILS_PORT": 3000, "VITE_PORT": 3100 },
  "env": { "STORAGE_PROVIDER": "disk" },
  "copy": [".env", "config/master.key"],
  "clone": ["node_modules"],
  "setup": ["bin/setup"],
  "dev": "bin/dev",
  "ready": { "url": "/up", "port": "RAILS_PORT" },
  "test": "bundle exec rspec",
  "browse": { "login": "/dev/login", "map": "docs/browsing.md" },
  "database": { "from": "app_development", "env": "DATABASE_NAME" },
  "notes": ["Kill your own server by port: lsof -ti tcp:$RAILS_PORT"],
  "merge": { "method": "squash" },
  "deploy": {
    "deployed": "~/.deploy/deployed",
    "health": "https://app.example.com/up"
  }
}
```

`merge` sets the project's merge method and branch clean-up (see
[Merging settings](../guides/tasks.md)).

`deploy` is how [Away mode](orchestrator.md) checks a merge went live: `deployed`
is a file your deploy writes the deployed commit to, `failed` (optional) one it
writes a commit whose deploy failed to, and `health` (optional) a URL that
answers 2xx once the server is back (a path alone is this AgentOS server's own,
as this repository's `agentos.json` uses with `scripts/autodeploy`'s state
files). A merge counts as deployed once the `deployed` commit contains it and
`health` answers; as failed when the `failed` commit contains it, the server
doesn't come back within 3 minutes (or, when its health answer has a
`startedAt`, hasn't restarted since the merge), or it isn't deployed `within_minutes`
(30) after the merge. No `deployed` file on the machine means nothing deploys
there, and nothing is checked.

Every task and worktree session takes a **port slot**, and each named port is
`base + slot` (a project with no `ports` still gets a `PORT` from 3100), so
parallel sessions never share a dev server port. The slot is kept on the
session and freed when it's done or deleted (an archived or merged one's once
its agent has stopped). The ports and
`env` are exported to the setup commands, the agent and its terminals; a port
always wins over an `env` entry of the same name, and `env` can't set names a
shell, runtime, git or the agent reads (`PATH`, `NODE_OPTIONS`, `TERM`,
`GIT_*`, `ANTHROPIC_*`, `AGENTOS_*`…): a config that sets one, such as
`NODE_OPTIONS` or `TERM`, is refused, and the error names the variable and why. The agent's brief gets a
short **Running this project** section: its ports, the dev command, how to
wait for `ready` in one backgrounded call, the test command, the login URL on
its own port, the browsing map and the notes. Only declared fields are
mentioned, and `env` values never are. Keep secrets out of the file: it is
committed.

With `database`, every task and worktree session gets its **own Postgres
database**, a copy of `from` named `<from>_aos_<hash of the session>`, made
before setup runs and exported as `env` (default `DATABASE_NAME`, plus
`PGPORT`/`DATABASE_PORT` and `PGHOST`/`DATABASE_HOST` when `port`/`host` are
set), so one session's migrations never reach another's. It's copied with
`pg_dump` into a database created from `template0`, not `createdb -T <from>`,
which refuses while the dev server is connected to `from`. Only a local server
is used (`host` may be `localhost`, `127.0.0.1`, `::1` or one socket folder), and
`from` must be a plain database name. A copy left by an earlier start of the
same session is reused. When Postgres isn't answering or the copy fails, the
session still starts, without one, and its brief says so. The copy is dropped
when the session is done, merged, dropped, moved away or deleted, and only one AgentOS made
for that session (its comment names the session): `from` and any other
database are never touched.

The file is validated against
[agentos.schema.json](../../lib/project-config/agentos.schema.json); a broken one
fails the setup with every bad field named, rather than being ignored. Without
an `agentos.json`, a `.dispatch.json` is read with the same meanings, then the
legacy `.agent-os/worktrees.json` and `.agent-os.json`. The config is always
read from the main checkout, so an agent can't change its own environment by
editing it, and the merge gates flag an edit to it as agent config. The full
schema, including the fields later releases implement (MCP servers, apps,
recipes), is in
[docs/decisions/2026-10-10-agentos-json.md](../decisions/2026-10-10-agentos-json.md).

## iOS simulator for tasks

On a Mac, a task on an iOS app can boot a simulator of its own, put a debug
build of its worktree on it, tap through screens, read the accessibility tree
and take screenshots, to check a UI fix before anyone installs a release
build. A project opts in with a `simulator` block in `agentos.json`:

```json
{
  "ports": { "METRO_PORT": 8100 },
  "simulator": {
    "start": "npm run sim",
    "app": "com.example.app",
    "device": "iPhone 17"
  }
}
```

`start` runs in the task's worktree with `SIMULATOR_UDID` (and the task's
ports) in its environment. It builds if needed, installs the app on that
device and exits 0 once the app is up; AgentOS builds nothing itself, because
the project knows its native fingerprint and what to cache. `app` is the
bundle id, and `device` the model (default `iPhone 17`).

A project without the block gets nothing: no brief lines and no tools. A task
declares nothing and chooses nothing; it runs:

```bash
aos sim open [--no-wait]   # make its simulator, run start; waits until it is up
aos sim status | close
aos sim snapshot -i        # accessibility tree with @e1, @e2... refs
aos sim click @e3 | fill @e5 "text" | scroll | swipe | back | home | find | wait
aos sim screenshot [path]  # prints a PNG path under ~/.agent-os/simulators/<task>/shots
aos sim logs --last 2m     # the app's recent log
```

- **Driving** is [agent-device](https://github.com/callstack/agent-device) (MIT),
  pinned and installed on first use into `~/.agent-os/tools`, with its own
  state dir. Only the commands above are accepted; the device and session are
  filled in by the server, so a task can only reach its own simulator.
- **One simulator per task**, cloned from a base device AgentOS makes once on
  the newest iOS runtime. At most two are booted at once across all tasks
  (`AGENTOS_SIMULATOR_MAX`); one idle for 15 minutes is shut down and boots
  again on its next command. The XCTest runner builds the first time per Xcode
  version (minutes), then is cached.
- **Cleanup**: a task's simulator is deleted when it is done, signed off,
  dropped, deleted or moved away, and shut down when stopped. A sweep at start
  and every 5 minutes also removes those of tasks that ended or crashed.
  Devices are named with a per-database prefix and only those are ever
  touched, so a dev instance and the real one never reap each other's.
- **Mac only.** On any other machine, including a linked one a task was moved
  to, the brief says the simulator is unavailable and `aos sim` says the same;
  nothing is forwarded between machines.
- **Optional.** No merge, review or release check reads simulator state.
  Screenshots are written outside the worktree, and the brief tells the task
  not to put them in commits or PR bodies unless they belong there.

---
title: Install AgentOS
description: Install AgentOS on macOS or Linux, get through the first-run setup, sign in your agent CLIs, keep it running, and reach it from other devices.
order: 1
---

# Install AgentOS

AgentOS runs on your own computer and opens in your browser. It starts your coding agents (Claude Code, Codex and others) in terminal sessions that you can watch, answer and review from one place. This guide takes you from nothing to a first session.

## Requirements

- **macOS or Linux.** On Windows, use WSL 2 (not WSL 1) and follow the Linux steps inside it. The [Windows section](#windows-wsl2) below has the notes.
- **Node.js 22 or newer.**
- **git.** Sessions work in git worktrees.
- **tmux.** Terminal sessions run inside it.
- **ripgrep and lsof** are optional. File search is slower without ripgrep, and finding what holds a port needs lsof.
- **At least one agent CLI**, such as Claude Code, Codex, OpenCode, Gemini CLI, GitHub Copilot CLI or Kiro CLI. The first-run setup can install and sign in most of them for you, so you don't need one before you start.

You don't have to collect these first. The installer checks for each one and offers to install what's missing.

## Install

Run the one-line installer:

```bash
curl -fsSL https://raw.githubusercontent.com/saadnvd1/agent-os/main/scripts/install.sh | bash
```

It needs git to start. It clones AgentOS to `~/.agent-os/repo` (or updates it if it's already there), then runs `agent-os install`, which:

1. Checks for Node.js 22+, git, tmux and ripgrep, and offers to install any that are missing.
2. Offers to install an agent CLI if you don't have one.
3. Installs dependencies and builds the app.
4. Puts the `agent-os` command in `~/.local/bin`, and adds that folder to your shell profile if it isn't on your `PATH` yet.

If it says `~/.local/bin` was added to your `PATH`, open a new terminal (or run `source ~/.zshrc`) before the next step.

The installer then offers to run `agent-os setup`, which you can also run any time:

```bash
agent-os setup
```

It starts AgentOS and keeps it running (it starts at login and restarts after a crash), asks how other devices should reach this machine (Connect, Tailscale or the same Wi-Fi), checks that they can, and offers a QR code for your phone. It's safe to run again: finished steps print "already done". `--via connect|tailscale|lan` skips the question, `--yes` takes the defaults without asking, and `--no-service` leaves start-at-login alone.

Already have Node.js? You can install from npm instead:

```bash
npm install -g @saadnvd1/agent-os
agent-os install
```

Then start it:

```bash
agent-os start
```

AgentOS runs in the background on `http://localhost:3011`. `agent-os status` shows its addresses, and `agent-os run` starts it and opens the browser. To use another port, set `AGENT_OS_PORT` before you start it.

Or run it from a source checkout:

```bash
git clone https://github.com/saadnvd1/agent-os
cd agent-os
corepack enable pnpm
pnpm install
npm run dev  # http://localhost:3011
```

## Windows (WSL2)

AgentOS runs on Windows inside WSL 2, as a Linux install. WSL 1 isn't
supported (`wsl --set-version <distro> 2`). In an Ubuntu or Debian distro,
run the install script above: it installs Node.js, tmux, ripgrep, lsof, a
compiler for the native modules, and `wslu`, then prints the WSL next steps.
The installer and the server both detect WSL the same way (the kernel
release names Microsoft, or `WSL_DISTRO_NAME` is set).

- **Open it from Windows** at `http://localhost:3011`. WSL 2 forwards
  localhost to the distro by default, and the server's loopback address is
  what's forwarded. Use `localhost`, not `127.0.0.1`: passkeys only work on
  localhost or https. With `networkingMode=mirrored` in `.wslconfig`
  (Windows 11), Windows and the distro share localhost directly. From a
  phone or another machine, install Tailscale inside the distro and use
  [Mobile access](phone.md) as on Linux.
- **Keep projects in the Linux filesystem** (`~/code/...`), not on the
  Windows drive (`/mnt/c/...`). Git, npm and file watching are many times
  slower there, and changes made from Windows aren't seen by file watchers
  (inotify doesn't cross the boundary), so the "/" menu only picks up new
  skills after its cache expires. The folder picker warns on `/mnt/<drive>`,
  and the server log lists projects that live there.
- **Links** open in the Windows browser through `wslview` (from `wslu`), or
  `explorer.exe` when it isn't installed. The server never touches the
  clipboard; copy buttons use the browser's.
- **Approvals with a passkey** use Windows Hello in the Windows browser,
  registered for `localhost` (a passkey made on the tailnet https address is
  a separate one).
- **Start at login**: `agent-os enable` writes a systemd user service,
  turns on linger (so it runs with no terminal open), and registers a
  Windows logon task that holds the distro open, because WSL otherwise stops
  an idle distro, service and all, seconds after its last terminal closes.
  The task starts when you log in to Windows, not at boot; a PC that should
  come up unattended needs Windows auto-login. It needs systemd in the
  distro: if it's off, `enable` offers to add `systemd=true` under `[boot]` in
  `/etc/wsl.conf` (it keeps a `.agentos-bak` copy), then asks you to run
  `wsl --shutdown` from Windows, reopen the terminal and run `enable` again.
  `agent-os disable` removes the service and the task.
- **Agent CLIs** installed only on Windows (an npm `claude` under `/mnt/c`)
  are ignored: they would run with a Windows home and config. The installer
  installs the Linux copy inside the distro, including Claude Code.
- **Ports** are shared with Windows through localhost forwarding. Before a
  session takes a port slot, AgentOS asks Windows (`netstat.exe`) what is
  listening, so a dev server on Windows `:3000` isn't collided with. If
  Windows can't be asked, it falls back to checking the distro alone.

## Link a machine (Windows PC, Linux box, Mac)

Any AgentOS machine can link any other, in either direction: a Windows PC in
WSL, a Linux box such as an NVIDIA DGX Spark (arm64), a Mac. You don't need a
Mac. Linked machines take tasks, and AgentOS Connect works from each of them
(`agent-os connect`, with cloudflared pinned for Linux x64 and arm64).

### With AgentOS Connect (any network; Free for one machine, Pro to link several)

This is the default. Neither machine needs Tailscale, sshd or an open port.
On the machine to be linked (the WSL distro or the Linux box):

```bash
agent-os connect    # sign in with the code from runagentos.com
agent-os machine    # prints these steps
```

Then, on the machine you'll link from, open **Machines**, press **Link** next
to the machine under **On your AgentOS account**, and type the 6-digit code it
shows on the machine to be linked (`agent-os link accept <code>` there, if it
has no browser). Type the second code it shows back to finish. The full flow is
in [Machines](https://github.com/saadnvd1/agent-os/blob/main/docs/reference/machines.md#linking-through-agentos-connect).

### Without Connect (Tailscale and ssh)

On the machine to be linked:

```bash
agent-os machine --tailscale
```

It installs and starts sshd (Debian and Ubuntu; elsewhere it names what to
install), checks that Tailscale is installed and signed in **inside this
machine**, runs `agent-os enable`, and prints the values to enter. It never
edits `sshd_config` or `authorized_keys`. Install Tailscale inside the WSL
distro itself: a WSL 2 distro sits behind NAT, so the Windows host's Tailscale
doesn't reach it (mirrored networking is an untested alternative).

On the machine you'll link from, which also needs Tailscale (inside its
distro, if it's WSL) and an ssh key the target accepts
(`ssh-copy-id <user>@<name>`), open **Machines → Add** and enter what
`agent-os machine --tailscale` printed. Pairing asks the target for a one-time
code over ssh, claims it over HTTP, and keeps the device token; tasks and moves
then go over HTTP.

What's been verified: the WSL detection, the installer's WSL paths, `enable`,
`disable`, `agent-os machine` (both paths), the Windows port check and the Windows-drive CLI
filter have unit tests that run on any OS. The [WSL workflow](https://github.com/saadnvd1/agent-os/blob/main/.github/workflows/wsl.yml)
runs on a GitHub-hosted Windows runner (Windows Server 2025, Ubuntu 24.04
under WSL 2) on changes to these files and weekly: the installer, tmux and
node-pty, the server reached from Windows at `localhost` and `127.0.0.1`,
Windows listeners seen from the distro, the real cloudflared download with
its pinned hash, and, as an advisory step, `enable` under systemd (linger and
the Windows logon task) and the ssh, pairing, token and API path that linking
uses. A Linux arm64 job (`ubuntu-24.04-arm`) stands in for a DGX Spark.
Untested, because it needs real hardware: a real Windows login starting the
distro, Tailscale inside WSL, linking across the tailnet, a live Connect
tunnel, Windows Hello approvals, links opening through `wslview`,
mirrored networking, WSL on Windows arm64, and distros other than Ubuntu.

## First run

On a fresh install the app opens a short setup at `/?welcome`. It appears only when you have no sessions and no projects of your own yet. Every step after the first can be skipped, and the whole thing can be left with **Skip setup**.

1. **Connect your agents.** Each agent CLI shows as **Ready**, **Needs sign-in** or **Not installed**. For one that is missing, choose the install button. For one that needs a sign-in, choose the sign-in button. Either one opens a small terminal in the page and types the official command for you, so you see exactly what runs and can answer any prompt. You need at least one agent ready to get work done. The page shows the main agents first; choose the **Show … more** button for the rest.
2. **Add your first project.** Open a folder already on this machine, clone a repo from a Git URL, or start an empty project with a name.
3. **Use it from your phone.** Pair a phone, link another machine, and set up notifications. All of it is optional and can be done later from Settings.
4. **Start.** Choose **Start your first session** to open a session in your project, then give the agent a task.

The setup is remembered on the server, so a phone you pair later doesn't see it. To run it again, open **Settings → Setup & health** and choose **Run setup again**, or go to `/welcome`. To turn it off entirely, start AgentOS with `AGENTOS_SKIP_WELCOME=1`.

## Check this machine

**Settings → Setup & health** lists what this machine has: Node.js, git, tmux, ripgrep, lsof and an agent CLI. Anything that is missing comes with the line that fixes it. Below that, **Agents on this machine** shows every agent CLI and its state, with the same install and sign-in buttons as the first-run setup.

## Sign in to your agent CLIs

AgentOS uses your own logins. It doesn't hold your credentials. The sign-in buttons run these commands for you in the embedded terminal, and you can run the same ones in any terminal:

| Agent          | Sign in                            |
| -------------- | ---------------------------------- |
| Claude Code    | `claude auth login`                |
| Codex          | `codex login`                      |
| GitHub Copilot | `copilot login`                    |
| Cursor CLI     | `cursor-agent login`               |
| Amp            | `amp login`                        |
| Kiro CLI       | `kiro-cli login --use-device-flow` |

Gemini CLI, Kilo Code and Pi sign in the first time you run them (`gemini`, `kilo`, `pi`). OpenCode has its own docs at [opencode.ai/docs](https://opencode.ai/docs).

### Kiro and Amazon Q

Kiro CLI (and the older Amazon Q CLI, `q`, which is shown only where it's installed) sign in with a device code. When you start a session, AgentOS checks `whoami`. If you're signed out, it runs `login --use-device-flow`, reads the link and one-time code off the screen, and shows them in a **card above the terminal**. You get a notification when it's waiting, so you can open the link and enter the code on your phone. No credential passes through AgentOS.

This covers Identity Center sign-in, including Microsoft or Okta federation. A login through an external identity provider doesn't support the device flow. In that case, sign in once on the machine itself, or set `KIRO_API_KEY`.

## Supported agents

| Agent          | Chat | Resume | Fork | Auto-approve                                 |
| -------------- | ---- | ------ | ---- | -------------------------------------------- |
| Claude Code    | ✅   | ✅     | ✅   | `--dangerously-skip-permissions`             |
| Codex          | ✅   | ✅     | ✅   | `--dangerously-bypass-approvals-and-sandbox` |
| OpenCode       | ✅   | ✅     | ✅   | `--auto`                                     |
| Pi             | ✅   | ✅     | ✅   | Never asks                                   |
| Kilo Code      | ❌   | ✅     | ✅   | Config file                                  |
| Gemini CLI     | ❌   | ❌     | ❌   | `--yolo`                                     |
| Aider          | ❌   | ❌     | ❌   | `--yes`                                      |
| Cursor CLI     | ❌   | ✅     | ❌   | `--force`                                    |
| Amp            | ❌   | ✅     | ❌   | `--dangerously-allow-all`                    |
| Oh My Pi       | ❌   | ❌     | ❌   | N/A                                          |
| GitHub Copilot | ✅   | ✅     | ❌   | `--allow-all`                                |
| Kiro CLI       | ❌   | ❌     | ❌   | `--trust-all-tools`                          |
| Amazon Q (old) | ❌   | ❌     | ❌   | `--trust-all-tools`                          |

Agents without chat run in the terminal. The new-session picker says when an

## CLI

```bash
agent-os run              # start and open the browser
agent-os start            # start in the background
agent-os stop             # stop the server
agent-os restart          # stop, then start
agent-os status           # show its addresses
agent-os setup            # guided setup: keep it running, reach it from other devices, add a phone
agent-os check            # can other devices reach this machine? names the cause and the fix
agent-os pair             # add a phone, tablet or laptop (prints a QR code)
agent-os logs             # tail the logs
agent-os update           # update to the latest version
agent-os enable           # start at login (disable turns it off)
agent-os machine          # how to link this box (Connect first; --tailscale sets up sshd + Tailscale)
agent-os passkeys reset   # when every passkey is lost (see Orchestrator)
agent-os uninstall
```

## Keep it running and up to date

`agent-os start` runs AgentOS until you stop it or restart the computer. To have it start at login:

```bash
agent-os enable
```

This writes a launchd service on macOS or a systemd user service on Linux, and both restart AgentOS if it crashes. If you edited the service file yourself, `agent-os setup` asks before replacing it. `agent-os disable` turns it off. Under WSL, `enable` needs systemd and also registers a Windows login task (see [Windows](#windows-wsl2)). To make a Linux box or WSL distro linkable from another AgentOS, run `agent-os machine` (Connect-first; `--tailscale` for the ssh route; see [Link a machine](#link-a-machine-windows-pc-linux-box-mac)).

The everyday commands:

```bash
agent-os status    # running or stopped, and its addresses
agent-os logs      # tail the server log
agent-os restart   # stop, then start
agent-os stop
```

To update:

```bash
agent-os update
```

It pulls the latest version, reinstalls dependencies, rebuilds, and starts AgentOS again if it was running. If you're already on the latest version, it says so and changes nothing.

### Automatic updates

AgentOS keeps itself up to date. It checks its own git remote every hour, and once a new version has been out for two hours (so a bad release can be fixed before anyone takes it), it updates as soon as everything has been idle for 10 minutes, at any time of day. To change this, open **Settings → Updates**:

- **Install updates automatically** turns it on or off. It is on unless you switch it off. `AGENTOS_AUTO_UPDATE=off` pins it off.
- **Idle for** sets how long nothing must be working first: 5, 10, 15, 30 or 60 minutes. `AGENTOS_AUTO_UPDATE_IDLE_MIN` pins it.
- A status line says what it is waiting for, and **Recent updates** lists the last few and how each one went.

"Idle" means nothing a restart would interrupt is happening: no agent working or chat reply being written, no review, no task setting up, no merge or stack landing, no simulator starting, and no build or deploy already running. It never interrupts work. If a new version has waited three days without a quiet moment, a two-minute lull is enough, and until then it keeps waiting.

What a restart keeps, and what starts over:

|                                                               |                                                       |
| ------------------------------------------------------------- | ----------------------------------------------------- |
| Terminals                                                     | Keep running; the page reconnects                     |
| Chats and task agents                                         | Keep running, mid-reply included; the page reconnects |
| Queued messages, schedules, notifications, `aos send --await` | Picked up again                                       |
| Reviews                                                       | Start over                                            |
| Task setups                                                   | Pick up where they were, or run again                 |
| A merge in progress, a simulator starting                     | Cut off, which is why it waits for them               |

Each update goes like this:

1. It backs up the database. The last three copies are kept in `~/.agent-os/backups`.
2. It pulls, installs and builds beside the running server. If any of that fails, the running server is left as it was. It tries that version again after an hour, then after six hours, and then gives up on it until a newer one comes out.
3. It swaps the new build in and restarts.
4. It checks the new server: it answers on the new version, every database migration ran, the main pages load, and it stays up for two minutes. If any of that fails, it puts the previous version back (code, dependencies and build), restarts, and never tries that version again. The banner says so, quietly.

A computer that slept or lost power mid-update recovers when AgentOS next starts: a half-done update is undone and tried again later. Your phone only hears about it when an update and its rollback both failed, or after three failed updates in a row.

The database is never restored on a rollback, because chats keep writing to it through the restart. Updates only ever add to it, so the previous version runs fine on it. If you need an older copy, stop AgentOS, copy one of the backups over `agent-os.db`, and start it again.

A machine whose checkout is deployed by `scripts/autodeploy` (a self-hosted setup that deploys every push) is left to it: Settings says so, and automatic updates stay off there.

Automatic updates skip a checkout they can't update safely, and Settings says why: local changes, not on the default branch, commits the remote doesn't have, a dev server, less than 3 GB of free disk (`AGENTOS_UPDATE_MIN_FREE_GB`), or no way to restart. On Linux, a service set up with `agent-os enable` before automatic updates existed needs `agent-os enable` once more, so a restart keeps terminals running.

### Update from the app

When a newer version is out, a slim banner offers **Update now** and **Dismiss**. Dismissing hides it for that version only, in that browser; the next version shows it again. After an automatic update, the banner says it updated and links to What's New.

**Settings → Updates** shows the installed and latest versions, has **Check for updates**, and a switch for the banner.

Update now pulls, installs and builds beside the running server, then restarts it and reloads the page. Terminals and chats keep running through the restart; reviews and task setups in progress start over. If something is working, you're asked first and can choose **Update when idle**, which waits until nothing is working (for up to a day) and can be cancelled. Update now takes the latest version straight away, without the two-hour wait.

It refuses, and says why, when the checkout has local changes, isn't on the default branch, has commits the remote doesn't, or is a dev server. The progress and any error show in the banner, and the full output is in `agent-os-update.log` next to the database. Only this machine, your tailnet, or a paired device with **Can approve** can start an update.

The restart uses `AGENTOS_RESTART` if you set it (for a service manager, for example), or `agent-os restart` when `agent-os start` started the server. Otherwise updating is disabled and says why: an update needs a restart command. `AGENTOS_UPDATE_CHECK=off` turns the background checks off (and with them automatic updates), and `AGENTOS_UPDATE_BANNER=off` pins the banner off.

To go back to the previous version by hand: `AGENTOS_RESTART="agent-os restart" scripts/redeploy --rollback --to <commit>` puts back the build, the dependencies and the code at that commit. Without `--to` it only puts back the build and dependencies.

## Reach it from other devices

By default AgentOS answers on the computer itself. `agent-os setup` walks you through choosing a way in. Or open **Settings → Devices & access**:

- **Same Wi-Fi.** Turn on **Allow devices on this Wi-Fi**. Only do this on a network you trust.
- **Tailscale.** Install [Tailscale](https://tailscale.com) on the computer and the other device, and sign in to the same account on both. `agent-os status` then shows a Tailscale address, and AgentOS trusts your tailnet by default.
- **AgentOS Connect.** Gives your machine a private address at runagentos.com that works from any network, with nothing to open on your router. Free for one machine; linking several machines is Pro. Link it with `agent-os connect`.

To add a phone, tablet or another computer, choose **Add a device** in Devices, or run `agent-os pair` to print a QR code. The [phone guide](phone.md) walks through pairing, Connect and notifications in full.

If a device can't get in, run `agent-os check`, or look at **Reachable from other devices** in Devices. It names the cause and the fix: see [Can't reach your machine](reachability.md).

## Uninstall

```bash
agent-os uninstall
```

It asks you to confirm, then stops AgentOS, turns off start-at-login, removes the `agent-os` command and deletes `~/.agent-os`. That folder holds your AgentOS data too, including the database and logs, so it is gone afterwards. If you installed with npm, it ends by printing `npm uninstall -g @saadnvd1/agent-os`, which removes the package itself.

## Troubleshooting

These are the messages **Settings → Setup & health** shows. For a phone or another computer that can't reach AgentOS, see [Can't reach your machine](reachability.md).

**"v18.x; AgentOS needs 20 or newer"**
The Node.js on your `PATH` is too old. Install Node.js 22 or newer from nodejs.org, or switch to it with your version manager, then open a new terminal and run `agent-os install` again.

**"Not found. Sessions work in git worktrees." / "Not found. Terminal sessions run inside tmux."**
git or tmux isn't installed. These two are required. Run the fix shown beside the message: `brew install git` or `brew install tmux` on macOS, and `sudo apt-get install -y git` or `sudo apt-get install -y tmux` on Debian and Ubuntu.

**"Not found. File search is slower without it." / "Not found. Finding what holds a port needs it."**
ripgrep or lsof is missing. AgentOS still works, so install them when convenient with the line shown.

**"No agent CLI installed"**
Install one in the **Agents** step or under **Agents on this machine**. Use the install button, or run the agent's own install line yourself.

**"… installed but needs sign-in"**
An agent CLI is there but isn't signed in. Choose its sign-in button, or run the sign-in command from the table above.

**"Couldn't check the agent CLIs"**
The check failed to run. Check again from the same screen. If it keeps happening, look at `agent-os logs`.

**"AgentOS is not installed. Run 'agent-os install' first."**
`start`, `update` and `enable` need a finished install. Run `agent-os install`.

**"Failed to start AgentOS. Check logs: agent-os logs"**
The server didn't come up. Run `agent-os logs` to see why. A common cause is another program using port 3011; start on a different port with `AGENT_OS_PORT`.

**"AgentOS is already running"**
It's already up. Use `agent-os status` for its address, or `agent-os restart` to bounce it.

**`agent-os: command not found`**
`~/.local/bin` isn't on your `PATH` yet. Open a new terminal, or run `source ~/.zshrc` (or your shell's profile).

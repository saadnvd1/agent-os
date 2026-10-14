---
title: Install AgentOS
description: Install AgentOS on macOS or Linux, get through the first-run setup, sign in your agent CLIs, keep it running, and reach it from other devices.
order: 1
---

# Install AgentOS

AgentOS runs on your own computer and opens in your browser. It starts your coding agents (Claude Code, Codex and others) in terminal sessions that you can watch, answer and review from one place. This guide takes you from nothing to a first session.

## Requirements

- **macOS or Linux.** On Windows, use WSL 2 (not WSL 1) and follow the Linux steps inside it. The [Windows section](#windows-wsl2) below has the notes.
- **Node.js 20 or newer.**
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

1. Checks for Node.js 20+, git, tmux and ripgrep, and offers to install any that are missing.
2. Offers to install an agent CLI if you don't have one.
3. Installs dependencies and builds the app.
4. Puts the `agent-os` command in `~/.local/bin`, and adds that folder to your shell profile if it isn't on your `PATH` yet.

If it says `~/.local/bin` was added to your `PATH`, open a new terminal (or run `source ~/.zshrc`) before the next step.

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
npm install
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
- **Start at login**: `agent-os enable` writes a systemd user service, which
  needs systemd in the distro. Add this to `/etc/wsl.conf`, then run
  `wsl --shutdown` from Windows and reopen the terminal:

  ```ini
  [boot]
  systemd=true
  ```

  WSL still stops an idle distro, service and all, a few seconds after its
  last terminal closes. To keep AgentOS up without a terminal open, add this
  to `%UserProfile%\.wslconfig` (Windows 11) and start the distro at Windows
  login, for example with a Task Scheduler task running
  `wsl.exe -d <distro> -- sleep infinity`:

  ```ini
  [general]
  instanceIdleTimeout=-1
  [wsl2]
  vmIdleTimeout=-1
  ```

What's been verified: the WSL detection and the installer's WSL paths have
unit tests that run on any OS, and the manual [WSL workflow](https://github.com/saadnvd1/agent-os/blob/main/.github/workflows/wsl.yml)
ran on a GitHub-hosted Windows runner (Windows Server 2025, Ubuntu 24.04
under WSL 2): the installer detected WSL 2 and installed what was missing
through apt, tmux, lsof and node-pty worked, the server started and logged
its WSL note, and Windows reached it at both `localhost:3011` and
`127.0.0.1:3011`. Untested: Windows Hello approvals, links opening through
`wslview`/`explorer.exe`, mirrored networking, `agent-os enable` under
systemd, the idle-timeout settings above, and Debian or other distros.

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
agent-os pair             # add a phone, tablet or laptop (prints a QR code)
agent-os logs             # tail the logs
agent-os update           # update to the latest version
agent-os enable           # start at login (disable turns it off)
agent-os passkeys reset   # when every passkey is lost (see Orchestrator)
agent-os uninstall
```

## Keep it running and up to date

`agent-os start` runs AgentOS until you stop it or restart the computer. To have it start at login:

```bash
agent-os enable
```

This writes a launchd service on macOS or a systemd user service on Linux. `agent-os disable` turns it off. Under WSL, `enable` needs systemd, which is set in `/etc/wsl.conf` (see [Windows](#windows-wsl2) for the lines).

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

### Update from the app

AgentOS checks its own git remote for a newer version every few hours. When there is one, a slim banner offers **Update now** and **Dismiss**. Dismissing hides it for that version only, in that browser; the next version shows it again. Nothing updates unless you choose it.

**Settings → Updates** shows the installed and latest versions, has **Check for updates**, and a switch for the banner (it also stops the background checks).

Update now pulls, installs and builds beside the running server, then restarts it and reloads the page. Terminals and chats keep running through the restart; reviews and task setups in progress start over. If something is working, you're asked first and can choose **Update when idle**, which waits until nothing is working (for up to a day) and can be cancelled.

It refuses, and says why, when the checkout has local changes, isn't on the default branch, has commits the remote doesn't, or is a dev server. The progress and any error show in the banner, and the full output is in `agent-os-update.log` next to the database. Only this machine, your tailnet, or a paired device with **Can approve** can start an update.

The restart uses `AGENTOS_RESTART` if you set it (for a service manager, for example), or `agent-os restart` when `agent-os start` started the server. Otherwise the update stops after building and tells you to restart. `AGENTOS_UPDATE_CHECK=off` turns the background checks off, and `AGENTOS_UPDATE_BANNER=off` pins the banner off.

## Reach it from other devices

By default AgentOS answers on the computer itself. Open **Settings → Devices & access** to add other devices:

- **Same Wi-Fi.** Turn on **Allow devices on this Wi-Fi**. Only do this on a network you trust.
- **Tailscale.** Install [Tailscale](https://tailscale.com) on the computer and the other device, and sign in to the same account on both. `agent-os status` then shows a Tailscale address, and AgentOS trusts your tailnet by default.
- **AgentOS Connect.** Gives your machine a private address at runagentos.com that works from any network, with nothing to open on your router. It is still in development. Link it with `agent-os connect`.

To add a phone, tablet or another computer, choose **Add a device** in Devices, or run `agent-os pair` to print a QR code. The [phone guide](phone.md) walks through pairing, Connect and notifications in full.

## Uninstall

```bash
agent-os uninstall
```

It asks you to confirm, then stops AgentOS, turns off start-at-login, removes the `agent-os` command and deletes `~/.agent-os`. That folder holds your AgentOS data too, including the database and logs, so it is gone afterwards. If you installed with npm, it ends by printing `npm uninstall -g @saadnvd1/agent-os`, which removes the package itself.

## Troubleshooting

These are the messages **Settings → Setup & health** shows.

**"v18.x; AgentOS needs 20 or newer"**
The Node.js on your `PATH` is too old. Install Node.js 20 or newer from nodejs.org, or switch to it with your version manager, then open a new terminal and run `agent-os install` again.

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

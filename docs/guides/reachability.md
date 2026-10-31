---
title: Can't reach your machine
description: When your phone or another computer can't reach AgentOS, run one check that names the cause, then apply the one-line fix for it.
order: 13
---

# Can't reach your machine

When your phone or another computer can't open AgentOS, the cause is almost always one of a short list: the server isn't running, something else holds its port, Wi-Fi access is off, Tailscale is logged out, or Connect isn't connected yet. AgentOS can tell which, so you don't have to guess.

## Run the check

On the computer running AgentOS:

```bash
agent-os check
```

It prints one line for each way in (Connect, Tailscale, Wi-Fi), a tick for the ones that work and, for the ones that don't, what's wrong and the line that fixes it. It exits 0 when every way in works, 1 when one works but something needs a look, and 2 when nothing works. `agent-os check --json` prints the same report for scripts.

The same check is the **Reachable from other devices** row in **Settings → Devices & access** and **Settings → Setup & health**. **Check again** runs it fresh.

Some problems fix themselves. While Connect is starting, or the Connect service is briefly unavailable, the row is amber and says **Retrying on its own, nothing to do**. If it's still failing after 5 minutes, it turns red and shows the fix.

When the check reaches your machine's Connect address, it fetches it the way your phone would, through the internet, and checks that the answer came from this server and not another one.

## Set it up again safely

```bash
agent-os setup
```

Setup is safe to run again. Each step checks first and prints "already done" when there's nothing to do. It never overwrites a service file you edited without asking, and it never changes your firewall, Tailscale, router or DNS: it tells you what to do instead. `agent-os setup --via lan` (or `connect`, `tailscale`) skips the question about how devices reach the machine.

## No way in from other devices yet

AgentOS only answers on the computer itself until you choose a way in: Connect, Tailscale or the same Wi-Fi.

Fix: `agent-os setup`

## AgentOS isn't running

Nothing answers on AgentOS's port (3011 unless you changed it).

Fix: `agent-os start`

If there's no background service yet, have it start at login and restart after a crash: `agent-os enable`

## AgentOS holds its port but isn't answering

AgentOS is on its port but didn't answer the check in time. It may be stuck on something.

Fix: `agent-os restart`

If it happens again, `agent-os logs` shows what it was doing.

## Another program holds AgentOS's port

Something that isn't AgentOS is listening on its port, so AgentOS can't. The check names the program when it can.

Fix: Stop that program, or move AgentOS: AGENT_OS_PORT=3012 agent-os restart

## Wi-Fi access is off

You asked for devices on the same Wi-Fi, but AgentOS only answers on the computer itself. Turn on **Allow devices on this Wi-Fi** in **Settings → Devices & access**, or:

Fix: `agent-os setup --via lan`

Only do this on a network you trust: traffic on the Wi-Fi isn't encrypted.

## The firewall may block devices on your Wi-Fi

The computer's firewall looks set to refuse incoming connections. The check can only read the settings from inside, so this is a warning, not proof. Try opening the address from your phone first.

Fix: Allow incoming connections for node in this computer's firewall settings

On macOS that's **System Settings → Network → Firewall → Options**. With ufw on Linux, `sudo ufw allow 3011/tcp`.

## Tailscale isn't installed

Fix: Install it from tailscale.com/download, then run agent-os check

Sign in to the same account on the computer and on your phone.

## Tailscale is logged out

Tailscale is installed but not connected.

Fix: `sudo tailscale up`

On a Mac, sign in from the Tailscale menu bar icon instead.

## Connect isn't linked

You asked for Connect, but this machine isn't linked to an account yet. Get a link code at runagentos.com (it's free for one machine), then:

Fix: `agent-os connect`

## Connect is turned off

This machine is linked, but Connect is switched off.

Fix: `agent-os connect --on`

The **Connect** switch in **Settings → Devices & access** does the same.

## Connect can't run in this server

This copy of AgentOS doesn't run Connect. The fix depends on why:

- Started with `AGENTOS_CONNECT=0`. Fix: Start AgentOS without AGENTOS_CONNECT=0
- Another AgentOS on the same computer already has the tunnel. Fix: Another AgentOS on this machine holds the tunnel: stop it, then agent-os restart
- A development build. Fix: Connect only runs from a production build: agent-os start
- Running on a different port from the one Connect was set up for. Fix: Connect follows AgentOS's own port: agent-os restart
- Started with pairing turned off. Fix: Connect never runs with pairing off: remove AGENTOS_AUTH=off
- Anything else. Fix: `agent-os logs`

## Connect refused this machine

The Connect service turned this machine away: it was removed from the account, or the account can't link more machines. Relink it with a new code:

Fix: `agent-os connect`

## The connector isn't connected yet

The connector that carries Connect's traffic is downloading, starting or reconnecting. AgentOS keeps retrying on its own. If this lasts more than 5 minutes, the logs say why. Often the network blocks the download or outgoing connections:

Fix: `agent-os logs`

## The Connect service isn't answering

AgentOS couldn't reach the Connect service, or it answered with an error. AgentOS keeps retrying on its own. If it lasts more than 5 minutes, check the logs:

Fix: `agent-os logs`

## Connect reaches this machine but AgentOS doesn't answer

The address works and the connector is connected, but the request didn't get an answer from AgentOS.

Fix: `agent-os restart`

## Another AgentOS answers this address

Your Connect address answered, but not from this server: another computer or another copy of AgentOS is using the same link.

Fix: Stop the other one, or run agent-os connect here

## The address doesn't resolve

The Connect address can't be found yet. A new address takes a minute to publish.

Fix: Wait a minute for it to publish, then agent-os check

If no name resolves at all, the problem is this computer's network, and your phone may still get in. Fix: This computer can't look up names: check its network or DNS settings

## This computer is offline

Fix: Connect it to the internet, then agent-os check

## The certificate didn't check out

The secure connection to the Connect address failed. Usually something on the network is reading HTTPS traffic, like a company proxy or a captive portal. Your phone on another network may be fine.

Fix: Something on this network intercepts HTTPS: try another network

If the computer's clock is wrong, every certificate looks invalid. Fix: Fix this computer's clock: it's more than 5 minutes off

## When the phone can't reach the machine at all

If the phone app can't connect, it can't ask the computer what's wrong. Run `agent-os check` on the computer and start from what it says.

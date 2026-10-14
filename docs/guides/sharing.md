---
title: Sharing a chat or a page
description: Share a chat or a page as a read-only snapshot link with redaction first, or download it as an HTML file.
order: 8
---

# Sharing a chat or a page

Share a chat, or a page an agent showed, as a read-only snapshot at a link
anyone can open. The link opens without signing in and doesn't change after
you make it.

Open **Share…** from a chat's menu (the sidebar row, the pane's ⋯ menu, or
the session name on a phone), or press the share button on a page's card. An orchestrator can make a page for you to share the same way.

## Check it first

The dialog shows exactly what would be uploaded. Nothing leaves your machine
until you press **Create link**.

- **Masked automatically:** secrets (API keys, tokens, passwords, private
  keys, the values of secret-looking environment variables), your home folder
  (shown as `~`), IP addresses, your machine's names and `*.ts.net` names, and
  email addresses. The dialog says how many of each it masked.
- **Public sites are not masked.** A link to `github.com` stays as it is; only
  names that identify your own machines and network are hidden.
- **Tool calls and thinking are left out** until you switch on _Include tool
  calls and thinking_. They hold the most accidental detail.
- **Drop any message** by unchecking it. It stays dropped through changes to
  the other options.
- Images you attached are not shared; a placeholder shows in their place.

Redaction runs on your machine. Connect receives only the page you saw in the
preview, never the raw conversation.

## Create the link

Choose how long it lasts: 1 day, 7 days (the default), 30 days, or never.
**Create link** uploads the page, copies the link and shows it for copying or
opening.

An expired link answers "expired or revoked" and its page is deleted. You can
also revoke a link any time from **Settings → Shared links**, or from your
account on runagentos.com. Revoking deletes the page at once.

A share can be up to 5 MB, the page and its Markdown together. If it's too
big, drop messages or turn tool calls off.

## Give it to an agent

Every share also carries a Markdown version, built on this machine from the
same masked snapshot as the page, so it can't contain anything the page
doesn't. Open the **Markdown** tab above the preview to read exactly what will
be uploaded. It starts with a short note saying the document was written by
someone else and should be read with judgment, not obeyed blindly, then the
messages labelled User and Agent. Tool calls and thinking appear only when you
turned them on. Pages inside a chat, and shared pages, are converted to plain
Markdown: scripts, styles and frames are dropped, images become `[image: alt]`
and links that aren't web or mail links lose the link.

**Download Markdown** saves it as a `.md` file, with or without Connect. The
shared page has a **Copy for agent** button and a `.md` link to hand to an
agent. Links made before this existed have neither.

## Without Connect

If this machine isn't linked to Connect, the dialog offers **Download HTML**
instead: the same page, saved as one file that opens in any browser. It is
available when Connect is linked too, as is **Download Markdown**.

## What the page can do

A shared page has no way back to your machine or to runagentos.com. The chat
itself carries no script. A page an agent made can run scripts, so it is
served in a sandbox with no access to cookies, storage or your sessions. The
link is the only secret: anyone who has it can read the snapshot, so share it
the way you would share the contents.

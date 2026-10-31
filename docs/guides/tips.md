---
title: Tips and What's New
description: Learn one AgentOS feature a day from the lightbulb in the sidebar, see what changed in each update, and turn the tips off.
order: 11
---

# Tips and What's New

Two small icons sit at the bottom of the sidebar: a lightbulb for **Tip of the Day** and a sparkle for **What's New**. Both open a dialog when you choose them, and neither ever opens by itself.

## Tip of the Day

The lightbulb shows one tip about something AgentOS can do: where it is, and what it does. A tip may have a picture or a short looping clip. A dot on the lightbulb means today's tip is new; it appears at most once a day and goes away when you open the tip.

- **Next** and **Previous** step through the tips that apply to you.
- **Learn more** opens the part of these guides that explains the feature.
- **Don't show tips** turns tips off and hides the lightbulb.

Tips skip what you already use. Once you have paired a phone, the tip about pairing one stops appearing, and the tip about schedules waits until you have no schedule yet. Tips you have read don't come back until you've seen them all.

What you've read is kept by AgentOS, not by the browser, so a tip you read on your laptop is read on your phone too.

### Turn tips off or on

**Settings → Updates → Show Tip of the Day** is the switch. It is the way back after **Don't show tips**.

## What's New

The sparkle lists what changed in each update, newest first. A dot means something new since you last opened it. Whether you've read it is remembered per browser.

## Adding a tip

Tips live in `content/tips.json`, in the repo. A change that adds a feature worth discovering adds one entry in the same pull request:

- `id`: lowercase words joined by hyphens, never reused.
- `title` (60 characters at most) and `body` (240 at most): one thing, said plainly, using the labels exactly as the app shows them.
- `guide`: the guide file (without `.md`) and the heading's anchor.
- `when`: optional. The tip shows only while every condition holds, for example `no-paired-device`.
- `added`: today's date. Newer tips come first; tips added the same day keep their order in the file.

A test checks every tip: unique ids, real guide sections, known conditions, nothing that looks like a path or a host, and picture sizes within budget.

### Pictures and clips

A tip can carry `media`: a still (WebP, light and dark) or a clip (muted looping MP4 with a WebP poster, 8 seconds or less) in `public/tips/`. Stills are at most 90 KB, clips 500 KB, posters 40 KB, and the folder 6 MB. Shoot them on demo data, never on a real instance. To ask for one, give the tip a `mediaBrief` (`kind`, `shot`). `node --import tsx scripts/tips-media.ts manifest` lists the tips waiting for media, and `apply <handback.json>` copies finished files in and fills the fields.

# AgentOS for iOS

A native client for AgentOS: your sessions with the web sidebar's shelves, chat with an agent, the orchestrator's asks, and a read-only view of terminal panes. It talks to the same server the web app does, over REST and the `/ws/status` and `/ws/chat` sockets.

Simulator and dev builds only, for now. It isn't on the App Store or TestFlight.

## Run it

```bash
cd apps/mobile
npm run ios                 # builds, installs on the iPhone 17 Pro simulator, starts Metro
scripts/ios "iPhone 17"     # another simulator
```

You need Xcode 26.4 or later, and Ruby with Bundler. The first build takes a few minutes; after that only JavaScript changes reload. Expo Go can't run it, because the app uses native modules Expo Go doesn't ship (keyboard controller, native tabs).

In the app, tap **Add a machine** and enter the address you open AgentOS at:

- In the simulator, use `http://127.0.0.1:3011`. In a dev build, **Use this Mac (simulator)** fills it in.
- On a phone, use the tailnet IP (`http://100.x.y.z:3011`), the tailnet HTTPS name (`https://<mac>.<tailnet>.ts.net:3443`), or a Connect address.

A link works too: `agentos://connect?url=<address>&code=<code>` fills both fields and connects, and `agentos://session/<id>` opens a session.

On loopback and the tailnet the server trusts the phone without pairing, so it connects straight away. Anywhere else, the app asks for a pairing code. On the web, open **Devices**, tap **Add a device**, and type the code, or paste the whole pairing link into the address field. The token goes into the iOS keychain, and the app sends it as `Authorization: Bearer` on every request and socket.

## Performance

Build with `EXPO_PUBLIC_PERF=1` and the app logs `[perf]` lines (time to the first sessions list, opening a thread, frame rate while a reply streams). Off, the marks cost nothing.

Measured on a Release build in the iPhone 17 Pro simulator, with the Mac busy (load ~45), against a local AgentOS. Medians of 5:

|                                        | Before                       | After                                                                       |
| -------------------------------------- | ---------------------------- | --------------------------------------------------------------------------- |
| Launch to the sessions list            | 3.0s                         | 3.0s (2.3s from process start; the app's own work after JS starts is ~0.2s) |
| Open a 2,124-block thread              | 548ms (list ready in ~100ms) | 542ms                                                                       |
| Memory with that thread open           | 169 MB                       | 150 MB                                                                      |
| JS frame rate, streaming and scrolling | 57–60 fps, worst frame 73ms  | same                                                                        |
| JS bundle (Hermes bytecode)            | 5.07 MB                      | 5.14 MB                                                                     |

The change was Metro's `inlineRequires` (`metro.config.js`): modules run when first used, which saved 19 MB. Launch time is React Native and iOS starting up, and loading the bundle; none of it is the app waiting on the network (the sessions request takes 2ms).

## Checks

```bash
npm run check    # typecheck, lint, format, tests: the app's own guard
```

The repo's `scripts/check`, the pre-commit hook, the root `tsconfig`, ESLint, Prettier and Vitest all skip `apps/`, and the root `npm ci` doesn't install any of this. The app has its own `package.json` and lockfile; it isn't a workspace.

## Architecture

- **Expo SDK 57** (React Native 0.86), Expo Router with typed routes, and `NativeTabs` for the system tab bar.
- **Shared protocol.** The app imports the server's own types and pure helpers from the repo's `lib/`, so the web and the app can't drift:
  - chat events and messages: `@/lib/chat/events`
  - timeline grouping: `@/lib/chat/group`
  - the suggestion chip: `@/lib/chat/suggestion`
  - diffs: `@/lib/chat/diff`
  - shelves: `@/lib/sidebar/shelves`
  - asks: `@/lib/orchestrator/ask-view`
  - the `Session`, `Project` and `Workspace` types

  `metro.config.js` watches only `lib/`, and maps `@/lib/*` there. Anything imported this way must stay client-safe: no database, no Node modules.

- **State.** React Query holds server data, keyed per machine. Live status from `/ws/status` is written into the query cache, as the web does. A small external store (`src/lib/store.ts`) holds the machine list and filters.
- **Sockets.** `src/lib/ws/socket.ts` is a JSON WebSocket that sends the bearer header, backs off from 1s to 30s, and reconnects as soon as the app is back in the foreground. `src/lib/chat/reducer.ts` applies chat messages the same way the web's `useChat` does: a snapshot replaces, an item upserts, a delta appends.
- **Markdown.** It's parsed with mdast (GFM) and drawn with native text views, so a selection can run across paragraphs. Code is highlighted with Prism (One Dark and One Light, as on the web), finished lines only while a reply streams. Code blocks and tables scroll sideways. Inline HTML shows as its text and never runs. Mermaid diagrams and `html_render` artifacts draw in sandboxed WebViews; the mermaid script comes from the machine (`/api/vendor/mermaid`), never a CDN.
- **The feed.** A virtualized list (`@legendapp/list`) in reading order: it opens at the end, follows a streaming reply while you're at the bottom and keeps your place when you scroll up. The header and composer are glass on iOS 26 and the feed scrolls under them.
- **Composer.** The web's: model, access and plan pills, the agent's slash commands and @file search (both over the chat socket), photos from the library, camera or Files, compressed before sending.
- **Addresses.** After connecting, the app learns every address the machine answers on (`/api/devices/network`) and moves to another when the current one stops. The device token only goes to HTTPS on Connect or `.ts.net`, or to the address you entered.

```
src/app/          routes: (tabs)/sessions, (tabs)/needs, (tabs)/machines, session/[id], connect, filters
src/components/   chat (timeline, blocks, markdown, composer), sessions, asks, terminal, ui
src/lib/          api, machines, sessions, chat, asks, ws, theme
```

**Theme.** The palette is the web's base light and dark themes (`styles/themes.css`, primary hue 262), following the system setting. Icons are SF Symbols, touch targets are at least 44pt, and key actions give haptic feedback.

**Icons.** The app icon and splash are rendered from the web's mark by `scripts/icons` (needs `rsvg-convert`). It writes light, dark and tinted iOS icons and the Android adaptive layers.

## What's next

- **Phase 2:**
  - a native terminal (libghostty) on `/ws/terminal`, replacing the read-only pane.
- **Push:**
  - APNs registration at pairing;
  - a sender on the server for needs-you, asks and turn-done.
- **Approve with Face ID.** Approving an ask needs a passkey today, and passkeys are tied to a hostname, so the app sends you to the web for now. The plan is a Secure Enclave key the phone registers when it pairs. The server sends a challenge, Face ID unlocks the key, and the key signs the challenge. That works on any address (tailnet, HTTPS, Connect), and it needs a security review before it ships.
- QR pairing with the camera.

Smaller items are in the repo's `ideas.md`, under "Mobile app".

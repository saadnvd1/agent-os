# Store listing drafts

Drafts only. Nothing here has been submitted. Character limits are the stores' own; counts are noted where it's close.

## App Store (iOS)

**Name** (30): AgentOS

**Subtitle** (30): Your coding agents, in your pocket

**Promotional text** (170):
Check on your agents from anywhere. See what's running, answer the ones waiting on you, and keep a conversation going from your phone.

**Keywords** (100, comma-separated, no spaces):
coding agent,ai agent,terminal,developer,remote,tailscale,code review,pull request,chat,sessions

**Description** (4000):

AgentOS runs your coding agents on your own computer. This app is how you keep up with them when you're away from it.

See every session at a glance. Sessions are grouped the way the web app groups them: pinned, needs you, working and done, with live status as agents start, finish or stop to ask something.

Answer what's waiting on you. When an agent asks a question or needs approval to run a command, it shows up under Needs you. Reply, decline, or open the conversation to see the context first.

Keep the conversation going. Read replies as they stream, with code highlighted, diffs with line numbers, diagrams and tables. Send a message, queue the next one while the agent works, stop a turn, or send a queued message right away. Attach photos from your library, camera or Files.

Pick the model, how much the agent may do without asking, and plan mode, from the same composer as the web app, with the agent's slash commands and @file search.

Your machine, your data. The app talks only to the AgentOS you run. Add it by its address on your network or tailnet, or through AgentOS Connect, and pair it with a one-time code. Nothing passes through a server of ours, and the app collects no data.

Requires AgentOS running on a Mac or Linux machine you can reach.

**What's New** (first version): First release.

**Category**: Developer Tools (secondary: Productivity)

**Age rating**: 4+ (no objectionable content; the app shows text from the user's own agents)

**Copyright**: © 2026 AgentOS

**Support URL**: SET_SUPPORT_URL (needs a page, see checklist)

**Marketing URL**: https://runagentos.com

**Privacy policy URL**: SET_PRIVACY_URL (needs a page, see checklist)

### App Privacy ("nutrition label")

Data Not Collected. The app sends nothing to the developer. Everything it shows comes from the user's own AgentOS server, and the device token it gets at pairing stays in the iOS keychain.

### Review notes

AgentOS is a client for a server the user runs on their own computer, so the reviewer needs a server to sign in to. Provide a demo server for the review:

- Address: SET_DEMO_ADDRESS (an AgentOS demo instance reachable over HTTPS with demo sessions only)
- Pairing code: SET_DEMO_CODE (Devices → Add a device on that server; codes expire, so make one just before submitting)

Steps: tap Add a machine, enter the address, then the code. The Sessions tab lists demo conversations; open one to see the chat, and Needs you shows a pending question.

App Transport Security: the app allows plain HTTP because users add their own machines by private tailnet or LAN IP address (for example 100.64.0.1:3011), where a certificate isn't available. Traffic to those addresses stays on the user's private network or WireGuard tunnel.

## Google Play

**App name** (30): AgentOS

**Short description** (80): Check on your coding agents, answer their questions and chat from your phone.

**Full description** (4000): same as the App Store description above.

**Category**: Tools

**Content rating**: questionnaire answers: no violence, no user-generated content shared with others, no ads, no purchases. Expected rating: Everyone.

**Data safety**: no data collected or shared. Data is sent only to the user's own server, encrypted in transit when that server uses HTTPS (Connect, tailnet HTTPS); plain HTTP is allowed for private network addresses.

**Ads**: none. **In-app purchases**: none.

**Feature graphic** (1024×500): `store/play/feature-graphic.png`

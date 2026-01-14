# iOS Safari WebSocket Reconnection

**Status:** Fixed (January 14, 2026)
**Commit:** `12bae2e`

## Problem

When using AgentOS on iOS Safari, the terminal would become unresponsive after the phone was locked or Safari was backgrounded. The UI would show "Reconnecting..." but never complete - the terminal stayed stuck.

## Root Cause

iOS Safari aggressively kills WebSocket connections when the page is backgrounded (screen off, app switch, etc.). Unlike desktop browsers, it often doesn't fire the `onclose` event - the socket just dies silently while `readyState` still shows `OPEN`.

The reconnection logic in `forceReconnect()` had a subtle bug:

```typescript
// websocket-connection.ts (before fix)
const forceReconnect = () => {
  const oldWs = wsRef.current;  // oldWs === ws (same object!)
  if (oldWs) {
    oldWs.onopen = null;        // This also nullified ws.onopen!
    oldWs.onmessage = null;
    oldWs.onclose = null;
    oldWs.onerror = null;
    try { oldWs.close(); } catch {}
  }

  const newWs = new WebSocket(...);
  newWs.onopen = ws.onopen;     // Copied null - handler was gone!
  newWs.onmessage = ws.onmessage;
  // ...
};
```

Since `oldWs` and `ws` referenced the **same WebSocket object**, setting `oldWs.onopen = null` also cleared `ws.onopen`. When we then tried to copy `ws.onopen` to the new socket, we copied `null`.

This meant the `onopen` handler never fired on the new connection, so:
- `callbacks.onConnected?.()` was never called
- The `tmux attach -t {session}` command was never sent
- The PTY shell had nothing to do and exited with code 1

## Solution

Save the handlers immediately after they're defined, before any reconnection logic could nullify them:

```typescript
// websocket-connection.ts (after fix)

// Define handlers
ws.onopen = () => { ... };
ws.onmessage = (event) => { ... };
ws.onclose = () => { ... };
ws.onerror = () => { ... };

// Save handlers immediately (for reconnection)
savedHandlers = {
  onopen: ws.onopen,
  onmessage: ws.onmessage,
  onclose: ws.onclose,
  onerror: ws.onerror,
};

// In forceReconnect:
const newWs = new WebSocket(...);
newWs.onopen = savedHandlers.onopen;      // Uses saved copy
newWs.onmessage = savedHandlers.onmessage;
// ...
```

## How to Debug Similar Issues

1. **Add server-side logging** to `server.ts`:
   ```typescript
   terminalWss.on("connection", (ws) => {
     const connId = `conn-${++counter}`;
     console.log(`[${connId}] NEW CONNECTION`);

     ws.on("message", (msg) => {
       const parsed = JSON.parse(msg);
       if (parsed.type === 'command') {
         console.log(`[${connId}] COMMAND: ${parsed.data}`);
       }
     });

     ws.on("close", (code) => {
       console.log(`[${connId}] CLOSED (code: ${code})`);
     });
   });
   ```

2. **Run server with visible logs**:
   ```bash
   npx tsx server.ts 2>&1 | tee /tmp/agent-os.log
   ```

3. **Look for the pattern**:
   - `NEW CONNECTION` ✓
   - `RESIZE` ✓ (indicates onopen ran partially)
   - `COMMAND: tmux attach` ✗ (missing = onConnected callback not firing)

## Related Files

- `components/Terminal/hooks/websocket-connection.ts` - WebSocket management and reconnection
- `components/Terminal/hooks/useTerminalConnection.ts` - React hook wrapping WebSocket
- `server.ts` - WebSocket server and PTY spawning

## iOS Safari Behavior Notes

- WebSockets die when page is backgrounded (even briefly)
- `readyState` may still show `OPEN` even when socket is dead ("hung socket")
- `onclose` event may not fire
- Page Visibility API (`document.visibilityState`) reliably detects background/foreground
- Force reconnect after >5 seconds hidden to handle hung sockets

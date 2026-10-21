// Local models served without tool-call parsing write their calls as text:
// <tool_call>{"name":…,"arguments":…}</tool_call> (Hermes, Qwen) or
// <tool_call><function=bash><parameter=command>…</parameter></function>
// </tool_call> (Qwen3-Coder). Pi only runs structured calls, so this Pi
// extension turns those trailing blocks in a finished reply into real tool
// calls. They are ordinary tool calls from then on: Pi's tool_call event
// fires for them, so the approvals extension (pi-approvals) asks, or lets
// them through, exactly as for a structured call. Exported for its test.
export const TEXT_TOOLS_EXTENSION = String.raw`const OPEN = "<tool_call>";
const CLOSE = "</tool_call>";
let count = 0;
const FENCE = String.fromCharCode(96).repeat(3);
const inFence = (text, at) => text.slice(0, at).split(FENCE).length % 2 === 0;
const trimOne = (v) => v.replace(/^\r?\n/, "").replace(/\r?\n$/, "");

function parseBody(body, schemas) {
  const b = body.trim();
  if (b.startsWith("{")) {
    let o;
    try {
      o = JSON.parse(b);
    } catch {
      return null;
    }
    let args = o.arguments ?? o.parameters ?? {};
    if (typeof args === "string") {
      try {
        args = JSON.parse(args);
      } catch {
        return null;
      }
    }
    if (typeof o.name !== "string" || !args || typeof args !== "object" || Array.isArray(args)) return null;
    return { name: o.name, arguments: args };
  }
  const f = /^<function=([^>\s]+)>([\s\S]*?)(?:<\/function>)?$/.exec(b);
  if (!f) return null;
  const props = schemas.get(f[1])?.properties ?? {};
  const args = {};
  for (const m of f[2].matchAll(/<parameter=([^>\s]+)>([\s\S]*?)<\/parameter>/g)) {
    const raw = trimOne(m[2]);
    let value = raw;
    if (props[m[1]]?.type && props[m[1]].type !== "string") {
      try {
        value = JSON.parse(raw);
      } catch {}
    }
    args[m[1]] = value;
  }
  return { name: f[1], arguments: args };
}

// The calls in a tail that is nothing but call blocks, or null.
function parseTail(tail, schemas) {
  const calls = [];
  let pos = 0;
  for (;;) {
    while (pos < tail.length && /\s/.test(tail[pos])) pos++;
    if (pos >= tail.length) break;
    if (!tail.startsWith(OPEN, pos)) return null;
    const start = pos + OPEN.length;
    const end = tail.indexOf(CLOSE, start);
    const call = parseBody(end < 0 ? tail.slice(start) : tail.slice(start, end), schemas);
    if (!call || !schemas.has(call.name)) return null;
    calls.push(call);
    if (end < 0) break;
    pos = end + CLOSE.length;
  }
  return calls.length ? calls : null;
}

export default function (pi) {
  pi.on("message_end", async (event) => {
    const m = event.message;
    if (m?.role !== "assistant" || m.stopReason !== "stop" || !Array.isArray(m.content)) return;
    if (m.content.some((c) => c.type === "toolCall")) return;
    let at = -1;
    for (let i = m.content.length - 1; i >= 0; i--) {
      if (m.content[i].type === "text") {
        at = i;
        break;
      }
    }
    if (at < 0 || !m.content[at].text.includes(OPEN)) return;
    const text = m.content[at].text;
    const schemas = new Map();
    const active = new Set(pi.getActiveTools());
    for (const t of pi.getAllTools()) if (active.has(t.name)) schemas.set(t.name, t.parameters ?? {});
    for (let from = text.indexOf(OPEN); from >= 0; from = text.indexOf(OPEN, from + 1)) {
      if (inFence(text, from)) continue;
      const calls = parseTail(text.slice(from), schemas);
      if (!calls) continue;
      const rest = text.slice(0, from).trimEnd();
      const content = m.content.slice();
      content[at] = { ...content[at], text: rest };
      if (!rest) content.splice(at, 1);
      for (const c of calls) {
        content.push({ type: "toolCall", id: "aostext_" + ++count + "_" + Math.random().toString(36).slice(2, 8), name: c.name, arguments: c.arguments });
      }
      return { message: { ...m, content, stopReason: "toolUse", aosRecovered: { index: at, text: rest } } };
    }
  });
}
`;

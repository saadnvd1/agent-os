// `aos claims [--all] [--json]`: what live sessions, on this machine and on
// linked machines, are working on. Without --all it narrows to your own
// session's repository.
module.exports = function makeClaims({ call, me }) {
  const ago = (ms) => {
    const m = Math.max(0, Math.round(ms / 60000));
    return m < 1 ? "just now" : m < 60 ? `${m}m` : `${Math.round(m / 60)}h`;
  };
  return async function claims(words) {
    const all = words.includes("--all");
    const json = words.includes("--json");
    const q = me && !all ? `?session=${encodeURIComponent(me)}` : "";
    const data = await call(`/api/claims${q}`);
    if (json) return console.log(JSON.stringify(data, null, 2));
    const byId = new Map(data.claims.map((c) => [c.id, c]));
    if (!data.claims.length) return console.log("no live claims");
    for (const c of data.claims) {
      const where =
        c.origin === data.machine.id ? "here" : `on ${c.originName}`;
      const n = c.files.length + c.filesMore;
      console.log(
        `${c.goal}  ·  ${where}  ·  ${c.branch || "no branch"}  ·  ${n} file${n === 1 ? "" : "s"}  ·  ${ago(Date.now() - c.startedAt)}`
      );
    }
    for (const o of data.overlaps) {
      const a = byId.get(o.a);
      const b = byId.get(o.b);
      console.log(
        `overlap (${o.strength}, ${o.kinds.join("+")}): ${a.goal} / ${b.goal}${o.shared.length ? `  ·  ${o.shared.slice(0, 5).join(", ")}` : ""}`
      );
    }
  };
};

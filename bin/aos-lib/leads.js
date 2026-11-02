// `aos leads [--all] [--json]`: your workspace's leads (or every workspace's
// with --all), each with the address `aos send` reaches it by.
module.exports = function makeLeads({ call, me }) {
  return async function leads(words) {
    const all = words.includes("--all");
    const json = words.includes("--json");
    const q = new URLSearchParams();
    if (me) q.set("from", me);
    if (all) q.set("all", "1");
    const data = await call(`/api/leads${q.size ? `?${q}` : ""}`);
    if (json) return console.log(JSON.stringify(data, null, 2));
    if (!data.workspaces.length)
      return console.log(
        data.enabled
          ? `no leads${data.workspace && !all ? " in your workspace (--all for every workspace)" : ""}`
          : "no leads (Leads is off in Settings → Experiments)"
      );
    for (const w of data.workspaces) {
      const chief = w.chiefAutonomy === "acts" ? "acts" : "acts on request";
      console.log(`${w.workspace}  ·  chief of staff ${chief}`);
      for (const l of w.leads) {
        const area = l.areas.length
          ? l.areas.map((a) => `${a.kind} ${a.value}`).join(", ")
          : l.kind === "tech"
            ? "every project"
            : "no area yet";
        console.log(
          `  ${l.title}  ·  ${l.name} (id ${l.sessionId.slice(0, 8)})  ·  ${area}  ·  aos send ${w.workspace}/${l.kind} "..."`
        );
      }
    }
  };
};

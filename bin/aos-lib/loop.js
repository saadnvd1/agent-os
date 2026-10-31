// `aos loop <task> start|status|stop|run`: the developer-analyst loop on a
// task, over the same routes the app uses.
module.exports = function makeLoop({ call, post, fail, me }) {
  const usage =
    'usage: aos loop <task> start --criteria "a" --criteria "b" [--cycles N] [--cost USD] [--minutes N] [--grace S]\n' +
    "       aos loop <task> status | stop | run";

  async function resolveTask(word) {
    const { peers } = await call(
      `/api/bus/peers${me ? `?from=${encodeURIComponent(me)}` : ""}`
    );
    const hits = peers.filter(
      (p) => p.id === word || p.id.startsWith(word) || p.name === word
    );
    if (hits.length !== 1)
      fail(
        hits.length
          ? `"${word}" matches several sessions`
          : `no session "${word}"`
      );
    return hits[0];
  }

  function flags(words) {
    const out = { criteria: [], limits: {} };
    const num = (v, name) => {
      const n = Number(v);
      if (!Number.isFinite(n)) fail(`${name} needs a number`);
      return n;
    };
    for (let i = 0; i < words.length; i++) {
      const w = words[i];
      const v = words[i + 1];
      if (w === "--criteria") out.criteria.push({ text: v, source: "user" });
      else if (w === "--cycles") out.limits.maxCycles = num(v, w);
      else if (w === "--cost") out.limits.maxCostUsd = num(v, w);
      else if (w === "--minutes") out.limits.maxMinutes = num(v, w);
      else if (w === "--grace") out.limits.graceSeconds = num(v, w);
      else fail(`unknown option ${w}`);
      i++;
    }
    return out;
  }

  function show(view) {
    if (!view) return console.log("no loop on this task");
    const { loop, criteria, cycles } = view;
    const met = criteria.filter(
      (c) => c.status === "met" || c.status === "waived"
    ).length;
    const state =
      loop.state === "running"
        ? view.hold
          ? `running (held: ${view.holdReason})`
          : "running"
        : `stopped: ${loop.stopReason}${loop.stopDetail ? ` (${loop.stopDetail})` : ""}`;
    console.log(
      `${state}  ·  cycle ${cycles[0]?.n ?? 0}/${loop.maxCycles}  ·  ${met}/${criteria.length} met  ·  $${view.spentUsd.toFixed(2)} of $${loop.maxCostUsd}`
    );
    for (const c of criteria)
      console.log(
        `  [${c.status}${c.verified ? "" : ", unverified"}] ${c.text}`
      );
    const last = cycles[0];
    if (last?.analysis) console.log(`last: ${last.analysis.summary}`);
  }

  return async function loop(words) {
    const [taskWord, verb, ...rest] = words;
    if (!taskWord || !verb) fail(usage);
    const task = await resolveTask(taskWord);
    const base = `/api/tasks/${encodeURIComponent(task.id)}/loop`;
    switch (verb) {
      case "start": {
        const f = flags(rest);
        if (!f.criteria.length) fail(usage);
        return show((await post(base, f)).view);
      }
      case "status":
        return show((await call(base)).view);
      case "stop":
        return show((await post(`${base}/stop`, {})).view);
      case "run":
        return show((await post(`${base}/run`, {})).view);
      default:
        fail(usage);
    }
  };
};

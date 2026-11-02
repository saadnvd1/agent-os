// `aos fork`, `aos children`, `aos return`, `aos cancel`, `aos wait children`:
// background copies of this session. Each call returns at once.
module.exports = function makeFork({ call, post, fail, needMe, me, stdin }) {
  const when = (deadline) =>
    `up to ${Math.max(1, Math.round((deadline - Date.now()) / 60000))}m`;

  const USAGE = {
    fork: 'aos fork [--worktree] [--label name] "<instruction>" ["<instruction>" ...]',
    children: "aos children [--stats] [<n>]",
    return: 'aos return [--failed] "<result>"',
    cancel: "aos cancel <n>|--all",
    wait: "aos wait children [--all|--any] [--timeout 30m]",
  };
  const FLAGS = {
    fork: ["--worktree", "--label"],
    children: ["--stats"],
    return: ["--failed"],
    cancel: ["--all"],
    wait: ["--all", "--any", "--timeout"],
  };

  // True when --help was asked for (usage printed, nothing else to do).
  function help(cmd, words) {
    if (words.includes("--help") || words.includes("-h")) {
      console.log(`usage: ${USAGE[cmd]}`);
      return true;
    }
    const bad = words.find(
      (w) => /^--?[a-z][a-z-]*$/i.test(w) && !FLAGS[cmd].includes(w)
    );
    if (bad) fail(`unknown option ${bad}\nusage: ${USAGE[cmd]}`);
    return false;
  }

  async function fork(words) {
    if (help("fork", words)) return;
    needMe();
    const instructions = [];
    const labels = [];
    let worktree = false;
    for (let i = 0; i < words.length; i++) {
      const w = words[i];
      if (w === "--worktree") worktree = true;
      else if (w === "--label") {
        // A label names the instruction that follows it.
        const label = words[++i];
        if (!label) fail("--label needs a name");
        labels[instructions.length] = label;
      } else instructions.push(w);
    }
    if (!instructions.length) fail(`usage: ${USAGE.fork}`);
    const r = await post("/api/fork", {
      from: me,
      instructions,
      labels: instructions.map((_, i) => labels[i] ?? ""),
      worktree,
      requestId: globalThis.crypto.randomUUID(),
    });
    console.log(
      `started ${r.children.length} ${r.children.length === 1 ? "fork" : "forks"}; keep working, results arrive as a message when they finish (or \`aos wait children --all|--any\`):`
    );
    for (const c of r.children) console.log(`  ${c.n}. ${c.label}`);
  }

  async function children(words) {
    if (help("children", words)) return;
    needMe();
    const stats = words.includes("--stats");
    const ref = words.find((w) => !w.startsWith("--"));
    if (ref) {
      const r = await call(
        `/api/fork/result?session=${encodeURIComponent(me)}&ref=${encodeURIComponent(ref)}`
      );
      console.log(
        `${r.n}. ${r.label} [${r.state}${r.outcome ? `, ${r.outcome}` : ""}${r.kind === "implicit" ? ", ended without aos return" : ""}]`
      );
      console.log(r.result ?? r.summary ?? "(no result yet)");
      return;
    }
    const r = await call(
      `/api/fork/children?session=${encodeURIComponent(me)}${stats ? "&stats=1" : ""}`
    );
    if (!r.children.length) console.log("no forks");
    for (const c of r.children)
      console.log(
        `${c.n}. ${c.label} [${c.state}${c.outcome ? `, ${c.outcome}` : ""}]${c.summary ? ` ${c.summary}` : c.asks ? ` asks: ${c.asks}` : ""}`
      );
    if (stats && r.text) console.log(`\n${r.text}`);
  }

  async function ret(words) {
    if (help("return", words)) return;
    needMe();
    const failed = words.includes("--failed");
    let text = words.filter((w) => w !== "--failed").join(" ");
    if (!text.trim()) text = await stdin();
    if (!text.trim()) fail(`usage: ${USAGE.return}`);
    const r = await post("/api/fork/return", { from: me, text, failed });
    console.log(
      r.state === "updated"
        ? "result updated"
        : "returned; you can end your turn"
    );
  }

  async function cancel(words) {
    if (help("cancel", words)) return;
    needMe();
    const all = words.includes("--all");
    const ref = words.find((w) => !w.startsWith("--"));
    if (!all && !ref) fail(`usage: ${USAGE.cancel}`);
    const r = await post("/api/fork/cancel", { from: me, ref, all });
    console.log(
      r.cancelled.length
        ? `cancelled ${r.cancelled.join(", ")}`
        : "nothing to cancel"
    );
  }

  async function wait(words) {
    if (help("wait", words)) return;
    needMe();
    const mode = words.includes("--any") ? "any" : "all";
    const i = words.indexOf("--timeout");
    const timeout = i >= 0 ? words[i + 1] : undefined;
    if (i >= 0 && !timeout) fail("--timeout needs a value like 30m");
    const r = await post("/api/fork/wait", { from: me, mode, timeout });
    if (r.already) {
      console.log(`not waiting: ${r.already}`);
      return;
    }
    console.log(
      `waiting for ${mode === "all" ? "all your forks" : "the next fork"} (${when(r.deadline)}): end your turn and you'll be woken with the results, or at the timeout`
    );
  }

  return { fork, children, ret, cancel, wait };
};

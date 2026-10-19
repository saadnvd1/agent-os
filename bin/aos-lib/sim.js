// `aos sim`: split out of bin/aos to keep it short.
module.exports = function makeSim({ me, call, post, fail }) {
  // `aos sim open|status|close|logs|<agent-device command>`: the task's own iOS
  // simulator (lib/simulator). The server picks the device; this only asks.
  async function sim(words) {
    const [sub, ...rest] = words;
    const base = `/api/sessions/${me}/simulator`;
    if (!sub)
      fail(
        "usage: aos sim open [--no-wait] | status | close | logs [--last 2m] | snapshot -i | click @e3 | fill @e5 text | screenshot [path] [--region @e3] ..."
      );
    if (sub === "status" || sub === "close") {
      const res =
        sub === "close"
          ? await call(base, { method: "DELETE" })
          : await call(base);
      console.log(simLine(res));
      for (const s of res.shots ?? []) console.log(`  ${s}`);
      return;
    }
    if (sub === "open") {
      const wait = !rest.includes("--no-wait");
      let res = await post(base, {});
      let shown = "";
      const started = Date.now();
      while (wait && (res.state === "creating" || res.state === "starting")) {
        const line = simLine(res);
        if (line !== shown) console.error(line);
        shown = line;
        if (Date.now() - started > 30 * 60_000)
          fail("timed out waiting for the simulator");
        await new Promise((r) => setTimeout(r, 2000));
        res = await call(base);
      }
      if (res.state === "failed")
        fail(res.error || "the simulator failed to start");
      console.log(simLine(res));
      return;
    }
    const body =
      sub === "logs"
        ? { logs: rest[rest.indexOf("--last") + 1] || "2m" }
        : { args: words };
    const res = await post(`${base}/run`, body);
    if (res.stdout)
      process.stdout.write(
        res.stdout.endsWith("\n") ? res.stdout : res.stdout + "\n"
      );
    if (res.stderr)
      process.stderr.write(
        res.stderr.endsWith("\n") ? res.stderr : res.stderr + "\n"
      );
    if (res.screenshot) {
      if (res.read && res.read !== res.screenshot) {
        console.log(`read: ${res.read}`);
        console.log(`full-size (for the PR): ${res.screenshot}`);
      } else console.log(res.screenshot);
    }
    if (res.code) process.exit(res.code);
  }

  function simLine(res) {
    if (res.state === "none") return "no simulator open";
    if (res.state === "creating") return "simulator: creating a device";
    if (res.state === "starting")
      return "simulator: booting, building and installing (a cold build takes minutes; the XCTest runner builds once per Xcode version)";
    if (res.state === "failed") return `simulator failed: ${res.error}`;
    return `simulator ${res.state}${res.udid ? ` (${res.udid})` : ""}`;
  }

  return sim;
};

// `aos heavy -- <cmd>`: waits for a heavy slot on this machine, starts the
// command, then registers it and prints the server's note, if any. A server
// that's down says nothing and the command runs at once.
module.exports = ({ url, token, me, fail }) =>
  async function heavy(words) {
    const argv = words[0] === "--" ? words.slice(1) : words;
    if (!argv.length) fail("usage: aos heavy -- <command...>");
    const { spawn } = require("child_process");
    // A nested `aos heavy` (scripts/check runs scripts/test) is inside a slot
    // already; asking again would wait on itself.
    const release = process.env.AOS_HEAVY_HELD
      ? null
      : await require("./heavy-lease.js")({ url, token, me }).acquire();
    // One argument is a shell command line ("npm test && npm run build").
    const scope = require("./heavy-scope.js");
    const which = (name) => {
      const r = require("child_process").spawnSync("which", [name], {
        encoding: "utf8",
      });
      return r.status === 0 && r.stdout.trim();
    };
    let run = scope.plan(argv, { which });
    if (run.scoped) {
      // systemd-run can exist without a user session bus; a no-op scope tells.
      const probe = require("child_process").spawnSync(
        "systemd-run",
        ["--user", "--scope", "--quiet", "--", "true"],
        { stdio: "ignore" }
      );
      if (probe.status !== 0) {
        console.error(
          "aos heavy: can't start a systemd scope, running without a memory cap"
        );
        run = scope.plan(argv, { which: () => null });
      }
    }
    const child = spawn(run.cmd, run.args, {
      stdio: "inherit",
      env: { ...process.env, AOS_HEAVY_HELD: "1" },
    });
    child.on("error", (err) => fail(`can't run ${argv[0]}: ${err.message}`));
    for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"])
      process.on(sig, () => child.kill(sig));
    child.on("exit", (code, signal) =>
      Promise.resolve(release?.()).finally(() => {
        if (run.scoped && scope.hitCap(code, signal))
          console.error(scope.capMessage(argv, run.memoryMax));
        process.exit(signal ? 1 : (code ?? 1));
      })
    );
    if (child.pid)
      fetch(url + "/api/load/heavy", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token && { Authorization: `Bearer ${token}` }),
        },
        body: JSON.stringify({
          session: me,
          pid: child.pid,
          command: argv.join(" "),
        }),
        signal: AbortSignal.timeout(1000),
      })
        .then((res) => (res.ok ? res.json() : {}))
        .then((data) => data.note && console.error(data.note))
        .catch(() => {});
  };

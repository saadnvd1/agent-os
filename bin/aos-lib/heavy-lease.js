// `aos heavy`: asks this machine's AgentOS for a heavy slot and waits its
// turn, so several sessions don't run builds and test suites at once. Anything
// the server can't answer lets the command run: a slot is courtesy, not a gate.
const POLL_MS = 3000;
const BEAT_MS = 10000;

module.exports = function makeHeavyLease({ url, token, me }) {
  const ask = async (action) => {
    try {
      const res = await fetch(url + "/api/load/heavy/lease", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token && { Authorization: `Bearer ${token}` }),
        },
        body: JSON.stringify({ session: me ?? null, pid: process.pid, action }),
        signal: AbortSignal.timeout(1500),
      });
      return res.ok ? await res.json() : null;
    } catch {
      return null;
    }
  };

  // Resolves with a function that gives the slot back.
  async function acquire() {
    let last = -1;
    const started = Date.now();
    for (;;) {
      const state = await ask("request");
      if (!state || typeof state.granted !== "boolean" || state.granted) break;
      if (state.ahead !== last) {
        console.error(
          `aos: waiting for a heavy slot (${state.ahead} ahead): forks run builds and test suites on this machine take turns`
        );
        last = state.ahead;
      }
      await new Promise((r) => setTimeout(r, POLL_MS));
    }
    if (last >= 0)
      console.error(
        `aos: got a heavy slot after ${Math.round((Date.now() - started) / 1000)}s`
      );
    const beat = setInterval(() => void ask("renew"), BEAT_MS);
    beat.unref();
    return async () => {
      clearInterval(beat);
      await ask("release");
    };
  }

  return { acquire };
};

// `aos heavy` containment: on Linux with systemd, the command runs in a
// transient user scope whose cgroup caps memory and process count, so one
// runaway build can't thrash the whole machine. macOS has no cgroups, so
// there the command runs uncapped, as before.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const os = require("os");

const DEFAULT_TASKS_MAX = 512;
const MEMORY_MAX_SHARE = 0.4;
const MEMORY_HIGH_SHARE = 0.85;

const mb = (bytes) => `${Math.max(1, Math.floor(bytes / 1048576))}M`;

// A size like "6G", "512M" or plain bytes; null when it isn't one.
function parseSize(text) {
  const m = /^(\d+(?:\.\d+)?)([KMGT]?)B?$/i.exec(String(text ?? "").trim());
  if (!m) return null;
  const unit = { "": 1, K: 1024, M: 1024 ** 2, G: 1024 ** 3, T: 1024 ** 4 };
  const bytes = Math.floor(Number(m[1]) * unit[m[2].toUpperCase()]);
  return bytes > 0 ? bytes : null;
}

function limits({ env = process.env, totalmem = os.totalmem() } = {}) {
  const max =
    parseSize(env.AOS_HEAVY_MEMORY_MAX) ?? totalmem * MEMORY_MAX_SHARE;
  const tasks = Number(env.AOS_HEAVY_TASKS_MAX);
  return {
    memoryMax: mb(max),
    memoryHigh: mb(max * MEMORY_HIGH_SHARE),
    tasksMax: Number.isInteger(tasks) && tasks > 0 ? tasks : DEFAULT_TASKS_MAX,
  };
}

// → { cmd, args, scoped, memoryMax }. `which` finds an executable or returns
// a falsy value; both it and `platform` are injected for tests.
function plan(
  argv,
  { platform = process.platform, which, env = process.env, totalmem } = {}
) {
  const shellLine = argv.length === 1;
  const plain = {
    cmd: shellLine ? "/bin/sh" : argv[0],
    args: shellLine ? ["-c", argv[0]] : argv.slice(1),
    scoped: false,
  };
  if (platform !== "linux" || !which?.("systemd-run")) return plain;
  const l = limits({ env, totalmem });
  return {
    cmd: "systemd-run",
    args: [
      "--user",
      "--scope",
      "--quiet",
      "-p",
      `MemoryHigh=${l.memoryHigh}`,
      "-p",
      `MemoryMax=${l.memoryMax}`,
      "-p",
      `TasksMax=${l.tasksMax}`,
      "--",
      plain.cmd,
      ...plain.args,
    ],
    scoped: true,
    memoryMax: l.memoryMax,
  };
}

// The cap's kill shows as SIGKILL, which a shell reports as 137.
const hitCap = (code, signal) => code === 137 || signal === "SIGKILL";

const capMessage = (argv, memoryMax) =>
  `aos heavy: ${argv.join(" ")} hit the memory cap (${memoryMax}) and was stopped. Fix the command (fewer parallel workers, a narrower run) rather than retrying it as is.`;

module.exports = { plan, limits, parseSize, hitCap, capMessage };

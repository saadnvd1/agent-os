// Proves the native modules work in a node_modules tree: open a SQLite
// database with better-sqlite3 and spawn a pty with node-pty. Used before a
// deploy swaps an install in, and by predev/prestart.
//   node scripts/check-native.mjs [node_modules dir]   (default: this checkout's)
//   --rebuild  on a Node ABI mismatch, run `pnpm rebuild` once and check again
import { createRequire } from "module";
import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const rebuild = args.includes("--rebuild");
const modules = path.resolve(
  args.find((a) => !a.startsWith("--")) ?? path.join(here, "..", "node_modules")
);

async function sqlite(require) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aos-native-"));
  try {
    const db = require("better-sqlite3")(path.join(dir, "check.db"));
    db.exec("create table t (v text); insert into t values ('ok')");
    const row = db.prepare("select v from t").get();
    db.close();
    if (row?.v !== "ok") throw new Error("better-sqlite3 read back nothing");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function pty(require) {
  return new Promise((resolve, reject) => {
    const p = require("node-pty").spawn("/bin/sh", ["-c", "echo pty-ok"], {});
    let out = "";
    const timer = setTimeout(() => {
      p.kill();
      reject(new Error("node-pty: no exit within 10s"));
    }, 10_000);
    p.onData((d) => (out += d));
    p.onExit(({ exitCode }) => {
      clearTimeout(timer);
      if (exitCode === 0 && out.includes("pty-ok")) resolve();
      else reject(new Error(`node-pty: exit ${exitCode}, output ${out}`));
    });
  });
}

async function failures() {
  const require = createRequire(path.join(modules, "noop.js"));
  const found = [];
  for (const [name, run] of [
    ["better-sqlite3", sqlite],
    ["node-pty", pty],
  ]) {
    try {
      await run(require);
    } catch (err) {
      found.push({ name, message: String(err?.message ?? err) });
    }
  }
  return found;
}

let bad = await failures();
if (
  bad.length &&
  rebuild &&
  bad.some((b) => b.message.includes("NODE_MODULE_VERSION"))
) {
  const names = bad.map((b) => b.name);
  console.log(`Rebuilding ${names.join(", ")} for Node ${process.version}...`);
  execFileSync("pnpm", ["rebuild", ...names], {
    cwd: path.dirname(modules),
    stdio: "inherit",
  });
  bad = await failures();
}
if (bad.length) {
  for (const b of bad)
    console.error(`native check failed: ${b.name}: ${b.message}`);
  process.exit(1);
}
console.log(`native modules ok (${modules})`);
process.exit(0);

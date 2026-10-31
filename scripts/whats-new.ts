// Adds the changelog entries for merges since the last run to
// content/whats-new.json. Run by scripts/autodeploy on the machine that
// publishes; installs only ever read the file.
//   whats-new.ts [--since-days N] [--through-file F] [--commit] [--dry-run]
// --commit also commits just that file and pushes it to origin/main.
import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";
import { askHaiku } from "@/lib/whats-new/claude";
import { generate, type PrInfo } from "@/lib/whats-new/generate";
import { WHATS_NEW_FILE } from "@/lib/whats-new/load";
import { readBlocklist } from "@/lib/whats-new/lint";

const root = process.cwd();
const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const value = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

const run = (cmd: string, a: string[]) =>
  execFileSync(cmd, a, { cwd: root, encoding: "utf-8", maxBuffer: 64 << 20 });
const git = (a: string[]) => run("git", a);

function prs(numbers: number[]): Map<number, PrInfo> {
  const rows = JSON.parse(
    run("gh", [
      "pr",
      "list",
      "--state",
      "merged",
      "--limit",
      "1000",
      "--json",
      "number,body,url",
    ])
  ) as { number: number; body: string; url: string }[];
  const want = new Set(numbers);
  return new Map(
    rows.filter((r) => want.has(r.number)).map((r) => [r.number, r])
  );
}

async function main() {
  const throughFile = value("--through-file");
  const commit = flag("--commit");
  if (commit) {
    git(["fetch", "-q", "origin", "main"]);
    const onMain = git(["rev-parse", "--abbrev-ref", "HEAD"]).trim() === "main";
    const level =
      git(["rev-parse", "HEAD"]).trim() ===
      git(["rev-parse", "origin/main"]).trim();
    if (
      !onMain ||
      !level ||
      git(["status", "--porcelain", "--untracked-files=no"]).trim()
    ) {
      console.log("whats-new: checkout is not a clean, current main; skipped");
      return;
    }
  }
  let through =
    throughFile && fs.existsSync(throughFile)
      ? fs.readFileSync(throughFile, "utf-8").trim()
      : null;
  if (through) {
    try {
      git(["cat-file", "-e", `${through}^{commit}`]);
    } catch {
      through = null;
    }
  }
  const before = git(["rev-parse", "HEAD"]).trim();
  const result = await generate(
    root,
    {
      through,
      sinceDays: Number(value("--since-days") ?? 30),
      write: !flag("--dry-run"),
    },
    { git, prs, ask: askHaiku, blocklist: readBlocklist() }
  );
  console.log(
    `whats-new: ${result.added.length} added, ${result.skipped} skipped, ${result.dropped.length} dropped`
  );
  for (const d of result.dropped)
    console.log(`  dropped #${d.pr}: ${d.reason}`);
  if (flag("--dry-run")) return;

  if (commit && result.added.length) {
    git(["add", WHATS_NEW_FILE]);
    git([
      "commit",
      "-q",
      "--no-verify",
      "-m",
      `chore(whats-new): add ${result.added.length} entries`,
      "--",
      WHATS_NEW_FILE,
    ]);
    try {
      git(["push", "-q", "origin", "HEAD:main"]);
    } catch (e) {
      git(["reset", "-q", "--hard", before]);
      throw e;
    }
  }
  if (throughFile) {
    fs.mkdirSync(path.dirname(throughFile), { recursive: true });
    fs.writeFileSync(throughFile, `${before}\n`);
  }
}

main().catch((e) => {
  console.error(`whats-new: ${e instanceof Error ? e.message : e}`);
  process.exit(1);
});

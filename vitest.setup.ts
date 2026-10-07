import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Tests never touch the real agent-os.db.
process.env.DB_PATH = join(
  mkdtempSync(join(tmpdir(), "agent-os-test-")),
  "test.db"
);

// Nor the Mac's usage window: a test that needs one injects it, so a run
// here behaves as it does in CI, where there is no limits.json.
process.env.AGENTOS_LIMITS_FILE = join(
  mkdtempSync(join(tmpdir(), "agent-os-limits-")),
  "missing.json"
);

// Nor the owner's phone: a test that sends sets its own notify command.
delete process.env.AGENTOS_NOTIFY_CMD;

// Under a git hook, GIT_DIR and friends point at this repository, so a test
// running git in a temp folder would act on it instead (a `git init` there
// once turned the real repo bare).
for (const key of Object.keys(process.env)) {
  if (key.startsWith("GIT_")) delete process.env[key];
}

// Every git the tests start (theirs, the code's, and the receiving side of
// a push) reads this global config instead of the author's: no background
// housekeeping, which forks `git maintenance run --auto` and pack-objects
// after each commit or push in a throwaway repo, a process storm when
// several suites run at once. A file rather than GIT_CONFIG_COUNT, which git
// drops for the other end of a local push.
const gitConfig = join(mkdtempSync(join(tmpdir(), "agent-os-git-")), "config");
writeFileSync(
  gitConfig,
  `[user]
\tname = Test
\temail = t@example.com
[maintenance]
\tauto = false
[gc]
\tauto = 0
[receive]
\tautogc = false
[core]
\tfsmonitor = false
[fetch]
\twriteCommitGraph = false
[commit]
\tgpgsign = false
[tag]
\tgpgsign = false
`
);
process.env.GIT_CONFIG_GLOBAL = gitConfig;

// Nor a model: sessions keep their placeholder name. A test of the titles
// injects its own runner.
process.env.AGENTOS_SESSION_TITLES = "off";

import { mkdtempSync } from "node:fs";
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

// Under a git hook, GIT_DIR and friends point at this repository, so a test
// running git in a temp folder would act on it instead (a `git init` there
// once turned the real repo bare).
for (const key of Object.keys(process.env)) {
  if (key.startsWith("GIT_")) delete process.env[key];
}

// Nor a model: sessions keep their placeholder name. A test of the titles
// injects its own runner.
process.env.AGENTOS_SESSION_TITLES = "off";

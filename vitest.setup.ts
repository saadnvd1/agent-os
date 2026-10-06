import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Tests never touch the real agent-os.db.
process.env.DB_PATH = join(
  mkdtempSync(join(tmpdir(), "agent-os-test-")),
  "test.db"
);

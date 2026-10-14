import { execFileSync } from "node:child_process";

// lib/db/migrations.ts imports a generated index of lib/db/migrations/; build
// it once before any worker loads the module.
export default function setup() {
  execFileSync(process.execPath, ["scripts/gen-migrations-index.mjs"], {
    stdio: "inherit",
  });
}

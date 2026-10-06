import path from "path";
import { ROOT } from "./config";

// The demo has no GitHub. A stand-in `gh` answers `gh pr list --head <branch>`
// from a fixed table, so tasks show real PR states; everything else fails
// the way an unauthenticated gh would.
export const PRS: Record<string, unknown[]> = {
  "feat/idempotency-keys": [
    {
      number: 214,
      url: "https://github.com/example/payments-api/pull/214",
      state: "OPEN",
      statusCheckRollup: [{ conclusion: "SUCCESS" }, { conclusion: "SUCCESS" }],
    },
  ],
  "feat/order-shipped-push": [
    {
      number: 88,
      url: "https://github.com/example/mobile-app/pull/88",
      state: "MERGED",
      statusCheckRollup: [{ conclusion: "SUCCESS" }],
    },
  ],
};

export const GH_SHIM = `#!/usr/bin/env node
const args = process.argv.slice(2);
const head = args.indexOf("--head");
if (args[0] !== "pr" || args[1] !== "list" || head === -1) {
  console.error("gh: not available in the demo");
  process.exit(1);
}
const prs = require(${JSON.stringify(path.join(ROOT, "prs.json"))});
console.log(JSON.stringify(prs[args[head + 1]] || []));
`;

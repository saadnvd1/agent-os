import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";
import { CODE, demoEnv } from "./config";

type Files = Record<string, string>;
interface Commit {
  message: string;
  files: Files;
  daysAgo: number;
}
interface Repo {
  name: string;
  commits: Commit[];
  // Left uncommitted, so the git panel has something to show.
  dirty?: Files;
}

const pkg = (name: string, scripts: Record<string, string>) =>
  JSON.stringify({ name, private: true, scripts }, null, 2) + "\n";

const TOTALS_BEFORE = `import type { Cart } from "../cart/types";
import { taxRateFor } from "./tax";

export function applyDiscount(cents: number, percent: number): number {
  return Math.round(cents * (1 - percent / 100));
}

export function cartTotal(cart: Cart): number {
  const subtotal = cart.items.reduce(
    (sum, item) => sum + applyDiscount(item.price * item.qty, cart.discount),
    0
  );
  const tax = Math.round(subtotal * taxRateFor(cart.region));
  return subtotal + tax;
}
`;

export const TOTALS_AFTER = TOTALS_BEFORE.replace(
  `  const subtotal = cart.items.reduce(
    (sum, item) => sum + applyDiscount(item.price * item.qty, cart.discount),
    0
  );`,
  `  const gross = cart.items.reduce((sum, i) => sum + i.price * i.qty, 0);
  const subtotal = applyDiscount(gross, cart.discount);`
);

const REPOS: Repo[] = [
  {
    name: "storefront",
    commits: [
      {
        message: "Initial storefront",
        daysAgo: 40,
        files: {
          "package.json": pkg("storefront", { dev: "vite", test: "vitest" }),
          "README.md": "# storefront\n\nThe customer-facing shop.\n",
          "src/cart/types.ts":
            "export interface Cart {\n  items: { sku: string; price: number; qty: number }[];\n  discount: number;\n  region: string;\n}\n",
          "src/checkout/tax.ts":
            "const RATES: Record<string, number> = { CA: 0.0725, NY: 0.04, TX: 0.0625 };\n\nexport const taxRateFor = (region: string) => RATES[region] ?? 0;\n",
        },
      },
      {
        message: "Add cart totals with discounts",
        daysAgo: 12,
        files: {
          "src/checkout/totals.ts": TOTALS_BEFORE,
          "src/checkout/totals.test.ts":
            'import { describe, expect, it } from "vitest";\nimport { cartTotal } from "./totals";\n\ndescribe("cartTotal", () => {\n  it("adds tax", () => {\n    expect(cartTotal({ items: [{ sku: "a", price: 1000, qty: 1 }], discount: 0, region: "CA" })).toBe(1073);\n  });\n});\n',
        },
      },
      {
        message: "Checkout: show savings line",
        daysAgo: 3,
        files: {
          "src/checkout/Summary.tsx":
            "export function Summary({ savings }: { savings: number }) {\n  return <p>You saved ${(savings / 100).toFixed(2)}</p>;\n}\n",
        },
      },
    ],
    dirty: { "src/checkout/totals.ts": TOTALS_AFTER },
  },
  {
    name: "payments-api",
    commits: [
      {
        message: "Initial service skeleton",
        daysAgo: 60,
        files: {
          "go.mod": "module example.com/payments\n\ngo 1.23\n",
          "README.md": "# payments-api\n\nCharges, refunds and webhooks.\n",
          "cmd/server/main.go":
            'package main\n\nfunc main() {\n\tserve(":8080")\n}\n',
        },
      },
      {
        message: "Webhooks: sign outgoing payloads",
        daysAgo: 9,
        files: {
          "internal/webhooks/sign.go":
            "package webhooks\n\n// Sign returns the HMAC of a payload.\nfunc Sign(secret, body []byte) string { return hmacHex(secret, body) }\n",
        },
      },
    ],
  },
  {
    name: "mobile-app",
    commits: [
      {
        message: "Expo app scaffold",
        daysAgo: 30,
        files: {
          "package.json": pkg("mobile-app", { start: "expo start" }),
          "app/index.tsx":
            "export default function Home() {\n  return null;\n}\n",
        },
      },
    ],
  },
  {
    name: "docs-site",
    commits: [
      {
        message: "Docs site",
        daysAgo: 20,
        files: {
          "package.json": pkg("docs-site", { dev: "astro dev" }),
          "src/content/getting-started.md": "# Getting started\n",
        },
      },
    ],
  },
  {
    name: "infra",
    commits: [
      {
        message: "Terraform: base network",
        daysAgo: 90,
        files: { "main.tf": 'module "network" {\n  source = "./network"\n}\n' },
      },
    ],
  },
  {
    name: "ml-pipeline",
    commits: [
      {
        message: "Feature store jobs",
        daysAgo: 15,
        files: {
          "pyproject.toml": '[project]\nname = "ml-pipeline"\n',
          "jobs/backfill.py": "def run(day):\n    ...\n",
        },
      },
    ],
  },
];

export const PROJECT_NAMES = REPOS.map((r) => r.name);

function write(dir: string, files: Files) {
  for (const [rel, content] of Object.entries(files)) {
    const file = path.join(dir, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  }
}

export function createRepos(): void {
  for (const repo of REPOS) {
    const dir = path.join(CODE, repo.name);
    fs.mkdirSync(dir, { recursive: true });
    const git = (args: string[], env: Record<string, string> = {}) =>
      execFileSync("git", args, { cwd: dir, env: demoEnv(env), stdio: "pipe" });
    git(["init", "-q", "-b", "main"]);
    for (const commit of repo.commits) {
      write(dir, commit.files);
      const date = new Date(Date.now() - commit.daysAgo * 86400000);
      git(["add", "-A"]);
      git(["commit", "-q", "-m", commit.message], {
        GIT_AUTHOR_DATE: date.toISOString(),
        GIT_COMMITTER_DATE: date.toISOString(),
      });
    }
    if (repo.dirty) write(dir, repo.dirty);
  }
}

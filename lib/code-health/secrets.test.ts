import { describe, expect, it } from "vitest";
import { duplicateBlocks, sqlConcat } from "./code";
import { redact, redactSecrets, secretScan } from "./secrets";
import { snippet } from "./source";

// Built at runtime so no credential-shaped literal is committed.
const fake = (prefix: string, n: number) =>
  prefix + "a1B2c3D4e5".repeat(10).slice(0, n);

describe("secretScan", () => {
  it("finds key shapes and keeps only a redacted stub", () => {
    const anthropic = fake("sk-ant-", 40);
    const github = fake("gh" + "p_", 36);
    const { secrets } = secretScan([
      {
        path: "lib/a.ts",
        text: `const key = "${anthropic}";\nconst ok = "hello";`,
      },
      { path: "docs/b.md", text: `token ${github}` },
    ]);
    expect(secrets).toEqual([
      {
        where: "lib/a.ts:1",
        kind: "anthropic-key",
        redacted: redact(anthropic),
      },
      { where: "docs/b.md:1", kind: "github-token", redacted: redact(github) },
    ]);
    expect(JSON.stringify(secrets)).not.toContain(anthropic);
  });

  it("finds a home directory, a tailnet address and a MagicDNS name", () => {
    const home = ["", "Users", "someone", "dev"].join("/");
    const tailnet = ["100", "101", "2", "3"].join(".");
    const magic = ["box", "tail1a2b3c", "ts", "net"].join(".");
    const { machineDetails } = secretScan([
      {
        path: "README.md",
        text: `cd ${home}/x\nssh ${tailnet}\nopen https://${magic}/\nsee 10.0.0.1 and 100.200.1.1`,
      },
    ]);
    expect(machineDetails.map((h) => [h.where, h.kind])).toEqual([
      ["README.md:1", "home-path"],
      ["README.md:2", "tailnet-ip"],
      ["README.md:3", "tailnet-name"],
    ]);
  });

  it("skips lockfiles and binaries", () => {
    const key = fake("sk-ant-", 40);
    expect(
      secretScan([
        { path: "package-lock.json", text: key },
        { path: "public/icon.png", text: key },
      ]).secrets
    ).toEqual([]);
  });
});

describe("redactSecrets", () => {
  it("cuts machine details to their stubs", () => {
    const home = ["", "Users", "someone", "dev"].join("/");
    const tailnet = ["100", "101", "2", "3"].join(".");
    const magic = ["box", "tail1a2b3c", "ts", "net"].join(".");
    const out = redactSecrets(`cd ${home}/x; ssh ${tailnet}; open ${magic}`);
    for (const raw of ["someone", tailnet, magic])
      expect(out).not.toContain(raw);
  });

  it("redacts before a snippet is cut, so a key at the edge leaves no prefix", () => {
    const key = fake("sk-ant-", 40);
    const out = snippet(`${"x".repeat(105)} ${key}`);
    expect(out).not.toContain(key.slice(0, 12));
  });

  it("reaches duplicate samples and SQL text", () => {
    const key = fake("sk-ant-", 40);
    const block = Array.from(
      { length: 6 },
      (_, i) => `send("${key}", ${i});`
    ).join("\n");
    const dups = duplicateBlocks(
      [
        { path: "lib/a.ts", text: block },
        { path: "lib/b.ts", text: block },
      ],
      { window: 3 }
    );
    expect(dups.blocks.length).toBeGreaterThan(0);
    expect(JSON.stringify(dups)).not.toContain(key);
    const sql = sqlConcat([
      {
        path: "lib/q.ts",
        text: `db.prepare(\`SELECT * FROM t WHERE k = '${key}' AND id = \${id}\`).get();`,
      },
    ]);
    expect(sql).toHaveLength(1);
    expect(sql[0].text).not.toContain(key);
  });

  it("cuts a bearer token in a header to its stub", () => {
    const token = fake("", 40);
    const out = redactSecrets(`curl -H "Authorization: Bearer ${token}" $URL`);
    expect(out).not.toContain(token);
    expect(out).toContain("Authorization: Bear…");
  });
});

describe("redact", () => {
  it("never returns a short value whole", () => {
    expect(redact("abc")).toBe("…");
    expect(redact("abcdefghijkl")).toBe("abcd…kl");
  });
});

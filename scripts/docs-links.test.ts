import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { headingSlugs, slug } from "./lib/heading-slugs";

const root = path.resolve(__dirname, "..");
const REPO = "saadnvd1/agent-os";

function markdownFiles(): string[] {
  const out = execFileSync(
    "git",
    ["ls-files", "--", "README.md", "docs/*.md", "docs/**/*.md"],
    { cwd: root, encoding: "utf8" }
  );
  return out.split("\n").filter(Boolean);
}

/** Link targets with their line numbers, skipping code. */
function targets(text: string): { line: number; target: string }[] {
  const found: { line: number; target: string }[] = [];
  let fence = false;
  text.split("\n").forEach((raw, i) => {
    if (raw.startsWith("```")) fence = !fence;
    if (fence) return;
    const line = raw.replace(/`[^`]*`/g, "");
    for (const m of line.matchAll(/\]\(([^)\s]+)\)/g))
      found.push({ line: i + 1, target: m[1] });
    for (const m of line.matchAll(/(?:src|srcset)="([^"]+)"/g))
      found.push({ line: i + 1, target: m[1] });
  });
  return found;
}

/** A repo path inside a link to this repository on github.com, if it is one. */
function repoPath(target: string): string | null {
  const m = new RegExp(
    `^https://(?:github\\.com/${REPO}(?:/(?:blob|tree)/main)?|raw\\.githubusercontent\\.com/${REPO}/main)/?(.*)$`
  ).exec(target);
  return m ? m[1] : null;
}

function readTracked(rel: string): string | null {
  const file = path.join(root, rel.replace(/\/$/, ""));
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) return null;
  return fs.readFileSync(file, "utf8");
}

describe("slug", () => {
  it("follows GitHub's anchors", () => {
    expect(slug("Project config (`agentos.json`)")).toBe(
      "project-config-agentosjson"
    );
    expect(slug("Windows (WSL2)")).toBe("windows-wsl2");
  });
});

describe("markdown docs", () => {
  const files = markdownFiles();

  it("have links that resolve", () => {
    const broken: string[] = [];
    for (const file of files) {
      const text = fs.readFileSync(path.join(root, file), "utf8");
      const own = headingSlugs(text);
      const inGuides = file.startsWith("docs/guides/");
      for (const { line, target } of targets(text)) {
        const at = `${file}:${line} -> ${target}`;
        if (target.startsWith("mailto:")) continue;
        let rel: string | null;
        let anchor = "";
        if (target.startsWith("#")) {
          if (!own.has(target.slice(1))) broken.push(at);
          continue;
        }
        if (/^https?:/.test(target)) {
          const hash = target.indexOf("#");
          const url = hash < 0 ? target : target.slice(0, hash);
          anchor = hash < 0 ? "" : target.slice(hash + 1);
          rel = repoPath(url);
          if (rel === null) continue;
          if (rel === "") rel = "README.md";
        } else {
          const [p, a = ""] = target.split("#");
          anchor = a;
          rel = path.posix.normalize(
            path.posix.join(path.posix.dirname(file), p)
          );
          if (
            inGuides &&
            !rel.startsWith("docs/guides/") &&
            !p.startsWith("http")
          )
            broken.push(`${at} (guides are published alone; link by full URL)`);
        }
        const abs = path.join(root, rel.replace(/\/$/, ""));
        if (!fs.existsSync(abs)) {
          broken.push(at);
          continue;
        }
        if (anchor && rel.endsWith(".md")) {
          const dest = readTracked(rel);
          if (dest === null || !headingSlugs(dest).has(anchor)) broken.push(at);
        }
      }
    }
    expect(broken).toEqual([]);
  });

  it("keep guide front matter complete, with unique order", () => {
    const orders = new Map<string, string>();
    const problems: string[] = [];
    for (const file of files) {
      if (!file.startsWith("docs/guides/") || file.endsWith("README.md"))
        continue;
      const text = fs.readFileSync(path.join(root, file), "utf8");
      const fm = /^---\n([\s\S]*?)\n---\n/.exec(text)?.[1] ?? "";
      for (const key of ["title", "description"])
        if (!new RegExp(`^${key}: .+`, "m").test(fm))
          problems.push(`${file}: missing ${key}`);
      const order = /^order: (\d+)$/m.exec(fm)?.[1];
      if (!order) problems.push(`${file}: missing numeric order`);
      else if (orders.has(order))
        problems.push(`${file}: order ${order} also in ${orders.get(order)}`);
      else orders.set(order, file);
    }
    expect(problems).toEqual([]);
  });

  it("keeps the README a front page", () => {
    const lines = fs
      .readFileSync(path.join(root, "README.md"), "utf8")
      .split("\n").length;
    expect(lines).toBeLessThan(250);
  });
});

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { lintText } from "@/lib/whats-new/lint";
import { BUDGET, mediaFiles } from "@/lib/tips/media";
import { fileSchema } from "@/lib/tips/schema";
import { headingSlugs } from "./lib/heading-slugs";

const root = path.resolve(__dirname, "..");
const read = (rel: string) => fs.readFileSync(path.join(root, rel), "utf8");
const { tips } = fileSchema.parse(JSON.parse(read("content/tips.json")));

describe("content/tips.json", () => {
  it("has enough tips with unique ids", () => {
    expect(tips.length).toBeGreaterThanOrEqual(25);
    const ids = tips.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("points at real guide sections", () => {
    const problems: string[] = [];
    for (const t of tips) {
      if (!t.guide) continue;
      const file = `docs/guides/${t.guide.file}.md`;
      if (!fs.existsSync(path.join(root, file))) {
        problems.push(`${t.id}: no ${file}`);
        continue;
      }
      if (t.guide.anchor && !headingSlugs(read(file)).has(t.guide.anchor))
        problems.push(`${t.id}: no #${t.guide.anchor} in ${file}`);
    }
    expect(problems).toEqual([]);
  });

  it("reads plainly and is safe for a public repo", () => {
    const problems: string[] = [];
    for (const t of tips) {
      const text = `${t.title} ${t.body}`;
      const why = lintText(text);
      if (why) problems.push(`${t.id}: ${why}`);
      if (/!|did you know/i.test(text)) problems.push(`${t.id}: voice`);
      if (t.mediaBrief && lintText(t.mediaBrief.shot))
        problems.push(`${t.id}: brief ${lintText(t.mediaBrief.shot)}`);
    }
    expect(problems).toEqual([]);
  });

  it("has media or a brief, never both, and the files fit the budget", () => {
    const problems: string[] = [];
    const used = new Set<string>();
    let total = 0;
    for (const t of tips) {
      if (t.media && t.mediaBrief) problems.push(`${t.id}: media and brief`);
      if (!t.media) continue;
      for (const { name, max } of mediaFiles(t.media)) {
        used.add(name);
        const file = path.join(root, "public/tips", name);
        if (!fs.existsSync(file)) {
          problems.push(`${t.id}: ${name} missing`);
          continue;
        }
        const size = fs.statSync(file).size;
        total += size;
        if (size > max) problems.push(`${t.id}: ${name} is ${size} bytes`);
      }
      if (
        t.media.kind === "video" &&
        t.media.durationMs > BUDGET.clipSeconds * 1000
      )
        problems.push(`${t.id}: clip too long`);
    }
    for (const f of fs.readdirSync(path.join(root, "public/tips")))
      if (f !== ".gitkeep" && !used.has(f)) problems.push(`unused ${f}`);
    expect(total).toBeLessThanOrEqual(BUDGET.total);
    expect(problems).toEqual([]);
  });
});

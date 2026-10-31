import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { slug } from "@/scripts/lib/heading-slugs";
import { CAUSES, guideAnchor, REACH_GUIDE } from "./classify";
import { REACH_CAUSES } from "./types";

// The guide quotes every title and fix line the CLI and the app print, so
// the two can't drift apart.
const guide = readFileSync(
  join(import.meta.dirname, "../../docs/guides", `${REACH_GUIDE}.md`),
  "utf8"
);

/** Each `## ` section's text by its anchor, code marks removed. */
function sections(text: string): Map<string, string> {
  const out = new Map<string, string>();
  let current: string | null = null;
  for (const line of text.split("\n")) {
    const h = /^## (.*)$/.exec(line);
    if (h) {
      current = slug(h[1]);
      out.set(current, "");
    } else if (current) {
      out.set(current, out.get(current) + line.replace(/`/g, "") + "\n");
    }
  }
  return out;
}

describe("the reachability guide", () => {
  const bySlug = sections(guide);

  it.each(REACH_CAUSES)("has a section for %s quoting its fix", (cause) => {
    const body = bySlug.get(guideAnchor(cause));
    expect(body, `no "## ${CAUSES[cause].title}" in the guide`).toBeDefined();
    const { fix, alt } = CAUSES[cause];
    for (const line of [fix, ...Object.values(alt ?? {})]) {
      expect(body, `"${line}" isn't under "${CAUSES[cause].title}"`).toContain(
        line
      );
    }
  });

  it("has the section the tip links to", () => {
    expect(bySlug.has("run-the-check")).toBe(true);
  });
});

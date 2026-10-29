import { describe, it, expect, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { tagSources } from "./skill-source";

const dirs: string[] = [];
const tmp = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "aos-skills-"));
  dirs.push(d);
  return d;
};
afterEach(() => {
  delete process.env.CLAUDE_CONFIG_DIR;
  for (const d of dirs.splice(0))
    fs.rmSync(d, { recursive: true, force: true });
});

const skill = (root: string, name: string, declared?: string) => {
  const d = path.join(root, "skills", name);
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(
    path.join(d, "SKILL.md"),
    `---\nname: ${declared ?? name}\ndescription: x\n---\n`
  );
};

describe("tagSources", () => {
  it("labels project, global, plugin and built-in commands", () => {
    const user = tmp();
    const repo = tmp();
    process.env.CLAUDE_CONFIG_DIR = user;
    skill(user, "audit");
    skill(path.join(repo, ".claude"), "session-audit");
    skill(user, "folder-name", "declared-name");
    const out = tagSources(
      [
        { name: "audit", description: "" },
        { name: "session-audit", description: "" },
        { name: "declared-name", description: "" },
        { name: "slack:search", description: "" },
        { name: "compact", description: "", builtin: true },
      ],
      repo
    );
    expect(out.map((c) => c.source)).toEqual([
      "global",
      "project",
      "global",
      "plugin",
      "builtin",
    ]);
    expect(out[3].plugin).toBe("slack");
  });

  it("prefers the project's copy over the user's", () => {
    const user = tmp();
    const repo = tmp();
    process.env.CLAUDE_CONFIG_DIR = user;
    skill(user, "debugging");
    skill(path.join(repo, ".claude"), "debugging");
    expect(
      tagSources([{ name: "debugging", description: "" }], repo)[0].source
    ).toBe("project");
  });
});

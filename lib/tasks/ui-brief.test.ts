import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { uiKindOf, uiVerifyBrief } from "./ui-brief";
import { briefFacts } from "./brief";

const project = (files: Record<string, string>) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aos-ui-"));
  for (const [name, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), body);
  }
  return dir;
};
const pkg = (deps: object) => JSON.stringify({ dependencies: deps });

describe("uiKindOf", () => {
  it("is web for a declared browse", () => {
    expect(uiKindOf(project({}), { browse: { login: "/x" } })).toBe("web");
  });

  it("is web for a web framework and for a Rails app with views", () => {
    expect(uiKindOf(project({ "package.json": pkg({ next: "1" }) }), {})).toBe(
      "web"
    );
    expect(
      uiKindOf(
        project({
          Gemfile: 'source "x"\ngem "rails", "~> 8"\n',
          "app/views/a.erb": "",
        }),
        {}
      )
    ).toBe("web");
  });

  it("is simulator when one is declared", () => {
    expect(uiKindOf(project({}), { simulator: { start: "npm run sim" } })).toBe(
      "simulator"
    );
  });

  it("is none for a library, a native app without a simulator, a bad package.json, or verify: false", () => {
    expect(uiKindOf(project({ "package.json": pkg({ zod: "1" }) }), {})).toBe(
      null
    );
    expect(
      uiKindOf(project({ "package.json": pkg({ react: "1", expo: "1" }) }), {})
    ).toBe(null);
    expect(uiKindOf(project({ "package.json": "{nope" }), {})).toBe(null);
    expect(uiKindOf(project({ Gemfile: 'gem "rails"' }), {})).toBe(null);
    expect(
      uiKindOf(project({ "package.json": pkg({ react: "1" }) }), {
        browse: { verify: false },
      })
    ).toBe(null);
  });
});

describe("briefFacts", () => {
  it("reads test, ui and browse from one config", () => {
    const dir = project({
      "agentos.json": JSON.stringify({
        test: "npm t",
        browse: { viewports: ["390x844"] },
      }),
    });
    expect(briefFacts(dir)).toEqual({
      test: "npm t",
      ui: "web",
      browse: { viewports: ["390x844"] },
    });
  });
});

describe("uiVerifyBrief", () => {
  it("is empty for no UI", () => {
    expect(uiVerifyBrief(null)).toBe("");
  });

  it("names chrome-devtools, forbids claude-in-chrome and saves in the worktree", () => {
    const text = uiVerifyBrief("web");
    expect(text).toContain("chrome-devtools");
    expect(text).toMatch(/Don't load or call `mcp__claude-in-chrome__\*`/);
    expect(text).toContain(".agentos/screenshots");
    expect(text).toContain("1440x900 and 390x844");
    expect(text).toContain("One snapshot to find a uid");
    expect(text).toContain("Verify the thing that would be wrong");
  });

  it("points the simulator at the existing guidance, briefly", () => {
    const text = uiVerifyBrief("simulator");
    expect(text).toContain("Simulator check");
    expect(text).not.toContain("chrome-devtools");
    expect(text.length).toBeLessThan(600);
  });
});

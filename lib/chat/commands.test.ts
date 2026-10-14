import { describe, it, expect } from "vitest";
import {
  insertCommand,
  isFreshCommand,
  withFresh,
  leadingCommand,
  rankCommands,
  slashQuery,
} from "./commands";
import type { ChatCommand } from "./events";

const cmd = (name: string, description = ""): ChatCommand => ({
  name,
  description,
});

describe("slashQuery", () => {
  it("opens on a / at the start of the input", () => {
    expect(slashQuery("/")).toEqual({ query: "", start: 0 });
    expect(slashQuery("/Comp")).toEqual({ query: "comp", start: 0 });
  });

  it("opens on a / after a space, anywhere in the text", () => {
    expect(slashQuery("fix this then /code-re")).toEqual({
      query: "code-re",
      start: 14,
    });
    expect(slashQuery("hi /")).toEqual({ query: "", start: 3 });
  });

  it("opens after a newline or tab", () => {
    expect(slashQuery("first\n/rev")).toEqual({ query: "rev", start: 6 });
    expect(slashQuery("a\t/x")).toEqual({ query: "x", start: 2 });
  });

  it("stays shut inside a word, URL or path", () => {
    expect(slashQuery("a/b")).toBeNull();
    expect(slashQuery("http://x")).toBeNull();
    expect(slashQuery("see src/lib/ch")).toBeNull();
    expect(slashQuery("/usr/bin")).toBeNull();
  });

  it("closes once the token ends or there is none", () => {
    expect(slashQuery("/compact now")).toBeNull();
    expect(slashQuery("hi /compact ")).toBeNull();
    expect(slashQuery("")).toBeNull();
  });

  it("filters by the text before the caret", () => {
    const text = "fix /co then ship";
    expect(slashQuery(text.slice(0, 7))?.query).toBe("co");
  });
});

describe("replacing the /token", () => {
  it("leaves the text around it alone", () => {
    const text = "fix this /co then ship";
    const caret = 12;
    const q = slashQuery(text.slice(0, caret))!;
    const out =
      text.slice(0, q.start) + insertCommand("code-review") + text.slice(caret);
    expect(out).toBe("fix this /code-review  then ship");
    expect(out.indexOf("/code-review")).toBe(q.start);
  });
});

describe("rankCommands", () => {
  const commands = [
    cmd("context", "Show context usage"),
    cmd("compact", "Clear history but keep a summary"),
    cmd("slack:standup", "Write a standup"),
    cmd("security-review"),
    cmd("model"),
  ];

  it("puts exact and prefix matches first", () => {
    expect(rankCommands("comp", commands).map((c) => c.name)).toEqual([
      "compact",
    ]);
    expect(rankCommands("co", commands).map((c) => c.name)).toEqual([
      "context",
      "compact",
    ]);
  });

  it("matches namespaced and dashed parts, then descriptions", () => {
    expect(rankCommands("standup", commands)[0].name).toBe("slack:standup");
    expect(rankCommands("review", commands)[0].name).toBe("security-review");
    expect(rankCommands("summary", commands)[0].name).toBe("compact");
  });

  it("lists everything for a bare slash", () => {
    expect(rankCommands("", commands)).toHaveLength(commands.length);
  });
});

describe("insertCommand", () => {
  it("leaves room for arguments", () => {
    expect(insertCommand("compact")).toBe("/compact ");
  });
});

describe("leadingCommand", () => {
  it("finds the command a message starts with", () => {
    expect(leadingCommand("/review the auth module")).toBe("/review");
    expect(leadingCommand("/plugin:skill-name")).toBe("/plugin:skill-name");
    expect(leadingCommand("/compact")).toBe("/compact");
  });
  it("ignores prose and paths", () => {
    expect(leadingCommand("fix /src/app.ts")).toBeNull();
    expect(leadingCommand("/src/app.ts is broken")).toBeNull();
  });
});

describe("/fresh", () => {
  it("is recognised alone, in any case, and not as prose", () => {
    expect(isFreshCommand("/fresh")).toBe(true);
    expect(isFreshCommand(" /Fresh ")).toBe(true);
    expect(isFreshCommand("/fresh now please")).toBe(false);
    expect(isFreshCommand("start /fresh")).toBe(false);
  });

  it("is offered once, ahead of the agent's own commands", () => {
    const own = [{ name: "review", description: "" }];
    expect(withFresh(own).map((c) => c.name)).toEqual(["fresh", "review"]);
    expect(withFresh(withFresh(own))).toHaveLength(2);
  });
});

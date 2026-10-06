import { describe, it, expect } from "vitest";
import {
  insertCommand,
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
  it("is active only while the message is a single /token", () => {
    expect(slashQuery("/")).toBe("");
    expect(slashQuery("/Comp")).toBe("comp");
    expect(slashQuery("/compact now")).toBeNull();
    expect(slashQuery("hi /compact")).toBeNull();
    expect(slashQuery("")).toBeNull();
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

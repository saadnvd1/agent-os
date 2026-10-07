import { describe, expect, it, vi } from "vitest";
import {
  fuzzyScore,
  matchCommands,
  PaletteRegistry,
  type PaletteCommand,
} from "./registry";

const cmd = (id: string, title: string, extra: Partial<PaletteCommand> = {}) =>
  ({ id, title, group: "Actions", run: () => {}, ...extra }) as PaletteCommand;

describe("fuzzyScore", () => {
  it("matches characters in order, and not out of order", () => {
    expect(fuzzyScore("usg", "Open Usage")).not.toBeNull();
    expect(fuzzyScore("gsu", "Open Usage")).toBeNull();
  });

  it("ranks a whole word above a scattered match", () => {
    expect(fuzzyScore("plan", "Toggle plan mode")!).toBeGreaterThan(
      fuzzyScore("plan", "Pick a large animal")!
    );
  });

  it("ranks a word start above a match inside a word", () => {
    expect(fuzzyScore("dev", "Devices")!).toBeGreaterThan(
      fuzzyScore("dev", "Undevised")!
    );
  });
});

describe("matchCommands", () => {
  const commands = [
    cmd("theme", "Toggle theme"),
    cmd("usage", "Open Usage", { keywords: ["cost", "tokens"] }),
    cmd("plan", "Toggle plan mode"),
    cmd("s1", "agent-os worktree", { group: "Sessions" }),
  ];

  it("lists everything, in order, for an empty query", () => {
    expect(matchCommands(commands, " ")).toEqual(commands);
  });

  it("finds by keyword and by group", () => {
    expect(matchCommands(commands, "cost").map((c) => c.id)).toEqual(["usage"]);
    expect(matchCommands(commands, "sessions").map((c) => c.id)).toEqual([
      "s1",
    ]);
  });

  it("puts the best title match first", () => {
    expect(matchCommands(commands, "tog")[0].id).toBe("theme");
    expect(matchCommands(commands, "plan mode")[0].id).toBe("plan");
  });
});

describe("PaletteRegistry", () => {
  it("collects commands per source and takes them back", () => {
    const r = new PaletteRegistry();
    const listener = vi.fn();
    r.subscribe(listener);
    const offApp = r.register("app", [cmd("a", "A"), cmd("b", "B")]);
    r.register("chat", [cmd("c", "C")]);
    expect(r.list().map((c) => c.id)).toEqual(["a", "b", "c"]);
    offApp();
    expect(r.list().map((c) => c.id)).toEqual(["c"]);
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it("replaces a source's commands, and an old unregister is a no-op", () => {
    const r = new PaletteRegistry();
    const offFirst = r.register("chat", [cmd("c", "Old")]);
    r.register("chat", [cmd("c", "New")]);
    offFirst();
    expect(r.list().map((c) => c.title)).toEqual(["New"]);
  });

  it("keeps the latest command for an id offered twice", () => {
    const r = new PaletteRegistry();
    r.register("a", [cmd("x", "From a")]);
    r.register("b", [cmd("x", "From b")]);
    expect(r.list().map((c) => c.title)).toEqual(["From b"]);
  });
});

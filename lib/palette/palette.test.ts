import { describe, expect, it } from "vitest";
import { scoreCommands, tabOf, type PaletteCommand } from "./registry";
import { allSections, emptySections, tabItems, withSeeAll } from "./sections";
import { cycleTab, parsePrefix } from "./tabs";
import {
  MAX_USAGE,
  recentIds,
  recordUse,
  usageBoost,
  type Usage,
} from "./usage";

const DAY = 86_400_000;
const NOW = 100 * DAY;
const cmd = (id: string, title: string, extra: Partial<PaletteCommand> = {}) =>
  ({ id, title, group: "Actions", run: () => {}, ...extra }) as PaletteCommand;

describe("usage boost", () => {
  it("is zero for an unused item and grows with use, with diminishing returns", () => {
    const at = (count: number) => usageBoost({ count, last: NOW }, NOW);
    expect(usageBoost(undefined, NOW)).toBe(0);
    expect(at(1)).toBeGreaterThan(0);
    expect(at(5)).toBeGreaterThan(at(1));
    expect(at(500)).toBeLessThanOrEqual(1);
    expect(at(10) - at(5)).toBeLessThan(at(5) - at(1));
  });

  it("halves every two weeks", () => {
    const fresh = usageBoost({ count: 8, last: NOW }, NOW);
    expect(usageBoost({ count: 8, last: NOW - 14 * DAY }, NOW)).toBeCloseTo(
      fresh / 2
    );
    expect(usageBoost({ count: 8, last: NOW - 140 * DAY }, NOW)).toBeLessThan(
      0.01
    );
  });
});

describe("ranking blend", () => {
  const commands = [
    cmd("a", "Open archive"),
    cmd("b", "Usage"),
    cmd("c", "Something unrelated"),
  ];

  it("never returns a non-match, however used", () => {
    const found = scoreCommands(commands, "usage", () => 1).map((m) => m.c.id);
    expect(found).toEqual(["b"]);
  });

  it("never lets use outrank a far better match", () => {
    const exact = cmd("exact", "Deploy");
    const loose = cmd("loose", "Do every project later oh yes");
    const ranked = scoreCommands([loose, exact], "deploy", (c) =>
      c.id === "loose" ? 1 : 0
    );
    expect(ranked[0].c.id).toBe("exact");
  });

  it("lets use break a tie between equal matches", () => {
    const x = cmd("x", "Open one");
    const y = cmd("y", "Open two");
    const boost = (c: PaletteCommand) => (c.id === "y" ? 0.8 : 0);
    expect(scoreCommands([x, y], "open", boost)[0].c.id).toBe("y");
  });

  it("orders an empty query by use, then registry order", () => {
    const boost = (c: PaletteCommand) => (c.id === "c" ? 0.5 : 0);
    expect(scoreCommands(commands, "", boost).map((m) => m.c.id)).toEqual([
      "c",
      "a",
      "b",
    ]);
  });
});

describe("recording use", () => {
  it("counts runs and stamps the last", () => {
    let u: Usage = recordUse({}, "x", 1);
    u = recordUse(u, "x", 2);
    expect(u.x).toEqual({ count: 2, last: 2 });
  });

  it("keeps at most MAX_USAGE items, dropping the faded ones", () => {
    let u: Usage = {};
    for (let i = 0; i < MAX_USAGE; i++)
      u = recordUse(u, `old${i}`, NOW - 90 * DAY);
    u = recordUse(u, "fresh", NOW);
    expect(Object.keys(u)).toHaveLength(MAX_USAGE);
    expect(u.fresh).toBeDefined();
  });

  it("lists the newest first", () => {
    const u: Usage = {
      a: { count: 9, last: 1 },
      b: { count: 1, last: 3 },
      c: { count: 1, last: 2 },
    };
    expect(recentIds(u, 2)).toEqual(["b", "c"]);
  });
});

describe("tab mapping", () => {
  it("files each group under one tab", () => {
    const tab = (group: string, extra: Partial<PaletteCommand> = {}) =>
      tabOf(cmd("t", "T", { group, ...extra }));
    for (const g of [
      "Actions",
      "Go to",
      "Workspaces",
      "Away",
      "Chat",
      "Task",
      "",
    ])
      expect(tab(g)).toBe("commands");
    expect(tab("Settings")).toBe("settings");
    expect(tab("Sessions")).toBe("sessions");
    expect(tab("Actions", { tab: "sessions" })).toBe("sessions");
  });
});

describe("prefixes and cycling", () => {
  it("reads > as Commands and @ as Sessions", () => {
    expect(parsePrefix(">new")).toEqual({ tab: "commands", text: "new" });
    expect(parsePrefix("@ agent")).toEqual({ tab: "sessions", text: "agent" });
    expect(parsePrefix(">")).toEqual({ tab: "commands", text: "" });
  });

  it("ignores text without a leading prefix", () => {
    expect(parsePrefix("new > thing")).toBeNull();
    expect(parsePrefix("")).toBeNull();
  });

  it("cycles both ways and wraps", () => {
    expect(cycleTab("all", 1)).toBe("sessions");
    expect(cycleTab("conversations", 1)).toBe("all");
    expect(cycleTab("all", -1)).toBe("conversations");
  });
});

describe("All with a query", () => {
  const sessions = Array.from({ length: 8 }, (_, i) =>
    cmd(`session.${i}`, `agent ${i}`, { group: "Sessions" })
  );
  const commands = [cmd("n", "New agent"), ...sessions];

  it("shows each tab's top 5 and counts the rest", () => {
    const sections = allSections(commands, "agent", {}, NOW);
    const s = sections.find((x) => x.name === "Sessions")!;
    expect(s.items).toHaveLength(5);
    expect(s.more).toEqual({ tab: "sessions", count: 8 });
    const c = sections.find((x) => x.name === "Commands")!;
    expect(c.more).toBeUndefined();
  });

  it("leads with the group holding the best match", () => {
    const sections = allSections(
      [cmd("a", "zzz archive"), cmd("s", "archive", { group: "Sessions" })],
      "archive",
      {},
      NOW
    );
    expect(sections.map((x) => x.name)).toEqual(["Sessions", "Commands"]);
  });

  it("ends a cut-short group with a See all row that opens its tab", () => {
    const opened: string[] = [];
    const sections = withSeeAll(
      allSections(commands, "agent", {}, NOW),
      (tab) => opened.push(tab)
    );
    const s = sections.find((x) => x.name === "Sessions")!;
    const row = s.items[s.items.length - 1];
    expect(s.items).toHaveLength(6);
    expect(row.title).toBe("See all 8 →");
    expect(row.keepOpen).toBe(true);
    row.run();
    expect(opened).toEqual(["sessions"]);
    expect(sections.find((x) => x.name === "Commands")!.items).toHaveLength(1);
  });

  it("lists a whole tab for See all, with the query kept", () => {
    expect(tabItems(commands, "sessions", "agent", {}, NOW)).toHaveLength(8);
  });
});

describe("empty state", () => {
  const commands = [
    cmd("app.a", "Alpha"),
    cmd("app.b", "Beta"),
    cmd("session.1", "Waiting one", {
      group: "Sessions",
      status: "waiting",
      detail: "Waiting on you",
    }),
    cmd("session.2", "Busy one", { group: "Sessions", status: "running" }),
    cmd("session.3", "Idle one", { group: "Sessions" }),
    cmd("chat.plan", "Plan mode", { group: "Chat" }),
    cmd("move.x", "Move this task", { group: "Task" }),
  ];
  const usage: Usage = Object.fromEntries(
    ["app.a", "app.b", "session.1", "session.3"].map((id, i) => [
      id,
      { count: 1, last: i + 1 },
    ])
  );

  it("composes recent, needs-you and this-session, without repeats", () => {
    const sections = emptySections(commands, usage);
    expect(sections.map((s) => s.name)).toEqual([
      "Recent",
      "Needs you / running",
      "This session",
    ]);
    const ids = (n: string) =>
      sections.find((s) => s.name === n)!.items.map((c) => c.id);
    expect(ids("Needs you / running")).toEqual(["session.1", "session.2"]);
    expect(ids("Recent")).toEqual(["session.3", "app.b", "app.a"]);
    expect(ids("This session")).toEqual(["chat.plan", "move.x"]);
    const all = sections.flatMap((s) => s.items);
    expect(all.length).toBeLessThanOrEqual(15);
    expect(new Set(all.map((c) => c.id)).size).toBe(all.length);
  });

  it("caps recent at 5, and omits the sections with nothing", () => {
    const many = Array.from({ length: 9 }, (_, i) => cmd(`c${i}`, `C${i}`));
    const used: Usage = Object.fromEntries(
      many.map((c, i) => [c.id, { count: 1, last: i + 1 }])
    );
    const sections = emptySections(many, used);
    expect(sections.map((s) => s.name)).toEqual(["Recent"]);
    expect(sections[0].items).toHaveLength(5);
  });

  it("suggests commands on a first run", () => {
    const sections = emptySections([cmd("a", "A"), cmd("b", "B")], {});
    expect(sections).toEqual([
      { name: "Suggested", items: [expect.anything(), expect.anything()] },
    ]);
  });
});

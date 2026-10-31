import { describe, expect, it } from "vitest";
import type { ChatModel } from "@/lib/chat/events";
import { buildSections, matchesElsewhere, matchesQuery } from "./sections";

const m = (value: string, group?: string): ChatModel => ({
  value,
  label: value.toUpperCase(),
  ...(group ? { group } : {}),
});

const models = [
  m("default"),
  m("a1", "Alpha"),
  m("a2", "Alpha"),
  m("b1", "Beta"),
];

describe("buildSections", () => {
  it("puts last used and the default on top, then groups without repeating them", () => {
    const s = buildSections({
      models,
      agentLabel: "X",
      defaultValue: "default",
      lastValue: "a2",
      query: "",
    });
    expect(s.map((x) => [x.heading, x.models.map((y) => y.value)])).toEqual([
      ["Last used", ["a2"]],
      ["Default", ["default"]],
      ["Alpha", ["a1"]],
      ["Beta", ["b1"]],
    ]);
  });

  it("shows the default once when it is also the last used", () => {
    const s = buildSections({
      models,
      agentLabel: "X",
      defaultValue: "default",
      lastValue: "default",
      query: "",
    });
    expect(s.map((x) => x.kind)).toEqual(["last", "group", "group"]);
  });

  it("filters to the matches, still grouped, and drops the top sections", () => {
    const s = buildSections({
      models,
      agentLabel: "X",
      defaultValue: "default",
      lastValue: "a2",
      query: "alpha a",
    });
    expect(s).toHaveLength(1);
    expect(s[0].models.map((y) => y.value)).toEqual(["a1", "a2"]);
  });

  it("is empty when nothing matches", () => {
    expect(buildSections({ models, agentLabel: "X", query: "zzz" })).toEqual(
      []
    );
  });

  it("lists ungrouped models under a plain heading", () => {
    const s = buildSections({ models: [m("a")], agentLabel: "X", query: "" });
    expect(s[0].heading).toBe("Models");
  });
});

describe("matchesQuery", () => {
  it("matches the agent's name as well as the model's", () => {
    expect(matchesQuery(m("a1", "Alpha"), "Copilot", "copilot alpha")).toBe(
      true
    );
    expect(matchesQuery(m("a1", "Alpha"), "Copilot", "beta")).toBe(false);
  });
});

describe("matchesElsewhere", () => {
  const agents = [
    { agent: "one", label: "One", models: [m("x")] },
    { agent: "two", label: "Two", models: [m("groq-a"), m("groq-b")] },
    { agent: "three", label: "Three", models: [m("groq-c")] },
  ];
  it("counts matches in the other agents and names the first with any", () => {
    expect(matchesElsewhere(agents, "one", "groq")).toEqual({
      count: 3,
      agent: "two",
    });
  });
  it("is null with no query or no match", () => {
    expect(matchesElsewhere(agents, "one", "")).toBeNull();
    expect(matchesElsewhere(agents, "one", "nope")).toBeNull();
    expect(matchesElsewhere(agents, "two", "groq-a")).toBeNull();
  });
});

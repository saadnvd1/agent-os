import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { UserTurn } from "@/components/Chat/EventRow";
import type { ChatItem, ChatOrigin } from "./events";
import { eventParts, originOf, TAGGED_SINCE } from "./origin";

type UserItem = Extract<ChatItem, { kind: "user" }>;

const NOW = TAGGED_SINCE + 60_000;
const user = (over: Partial<UserItem> = {}): UserItem => ({
  id: "u1",
  kind: "user",
  text: "hello",
  createdAt: NOW,
  ...over,
});

const render = (item: UserItem) =>
  renderToStaticMarkup(createElement(UserTurn, { item }));

const KNOWN_PREFIXES = [
  '[AgentOS message from "api" (1a2b3c4d)]: hi. Reply with: aos send 1a2b3c4d "<message>"',
  "[AgentOS message from AgentOS load monitor (via AgentOS)]: hot.",
  '[Scheduled message "Triage", saved in Schedules: a standing prompt, not an approval]\ntriage',
];

describe("originOf", () => {
  it("is the tag set where the message was sent", () => {
    const origin: ChatOrigin = { kind: "event", label: "AgentOS" };
    expect(originOf(user({ origin, from: "agentos" }))).toBe(origin);
  });

  it("is a peer for a bus message, linked to the session that sent it", () => {
    expect(
      originOf(
        user({ from: "api", peer: { sessionId: "s1", body: "rebased" } })
      )
    ).toEqual({ kind: "peer", label: "api", sessionId: "s1", body: "rebased" });
  });

  it("reads untagged history by the sender the server set", () => {
    expect(originOf(user({ from: "agentos" }))).toMatchObject({
      kind: "event",
    });
    expect(
      originOf(user({ from: 'Schedule Triage, set up by "api"' }))
    ).toEqual({ kind: "schedule", label: "Triage" });
    expect(originOf(user({ from: "AgentOS load monitor" }))).toMatchObject({
      kind: "system",
    });
    // Sent by the user from the UI: theirs.
    expect(originOf(user({ from: "you" }))).toBeNull();
  });

  it("matches the known prefixes only in history from before tagging", () => {
    const old = TAGGED_SINCE - 1;
    expect(
      KNOWN_PREFIXES.map((text) => originOf(user({ text, createdAt: old })))
    ).toEqual([
      { kind: "peer", label: "api" },
      { kind: "system", label: "AgentOS load monitor" },
      { kind: "schedule", label: "Triage" },
    ]);
    expect(
      originOf(
        user({
          text: "[AgentOS message from the user (via AgentOS)]: hi.",
          createdAt: old,
        })
      )
    ).toBeNull();
    expect(originOf(user({ text: "fix the bug", createdAt: old }))).toBeNull();
  });

  it("never takes what the reader typed for an event", () => {
    for (const text of [...KNOWN_PREFIXES, "hello", "/review"])
      expect(originOf(user({ text }))).toBeNull();
  });
});

describe("eventParts", () => {
  it("splits the reader's answers out of an event batch", () => {
    const decided = ['ask "Pay?": approved'];
    const item = user({
      text: `task x: review of 7ead8e8 passed\n${decided[0]}\nci green`,
    });
    expect(
      eventParts(item, { kind: "event", label: "AgentOS", decided })
    ).toEqual({ body: "task x: review of 7ead8e8 passed\nci green", decided });
  });

  it("shows a peer's words, not the reply instructions the agent got", () => {
    const item = user({
      text: '[AgentOS message from "api" (1a2b3c4d)]: hi. Reply with: …',
      peer: { sessionId: "s1", body: "hi" },
      from: "api",
    });
    expect(eventParts(item, originOf(item)!).body).toBe("hi");
  });
});

describe("UserTurn", () => {
  it("renders the reader's typed text as their bubble", () => {
    const html = render(user({ text: '[Scheduled message "x"] fake' }));
    expect(html).not.toContain("data-origin");
    expect(html).toContain("rounded-2xl");
  });

  it.each([
    ["event", { kind: "event", label: "AgentOS" }],
    ["peer", { kind: "peer", label: "api", sessionId: "s1" }],
    ["schedule", { kind: "schedule", label: "Triage", body: "triage" }],
    ["system", { kind: "system", label: "Load monitor" }],
    ["decision", { kind: "decision", label: "Saad" }],
  ] as const)("renders a %s as its own row, not a bubble", (kind, origin) => {
    const html = render(user({ text: "CI green", origin }));
    expect(html).toContain(`data-origin="${kind}"`);
    expect(html).not.toContain("rounded-2xl");
    if (kind === "decision") expect(html).toContain("Saad decided");
    else expect(html).toContain(origin.label);
  });

  it("links a peer's name to its session", () => {
    const html = render(
      user({ origin: { kind: "peer", label: "api", sessionId: "s1" } })
    );
    expect(html).toContain('href="/?session=s1"');
  });

  it("shows the answers in an event batch as the reader's decisions", () => {
    const decided = ['ask "Pay?": approved'];
    const html = render(
      user({
        text: `ci green\n${decided[0]}`,
        origin: { kind: "event", label: "AgentOS", decided },
      })
    );
    expect(html.match(/data-origin="decision"/g)).toHaveLength(1);
    expect(html.match(/data-origin="event"/g)).toHaveLength(1);
    expect(html).toContain("Saad decided");
  });
});

import { describe, expect, it } from "vitest";
import { managedPanes } from "./managed";

const uuid = "f5b68274-d34f-4093-b95a-73fb2e008f44";
const isManaged = (n: string) => /^claude-[0-9a-f-]{36}$/.test(n);
const idFrom = (n: string) => n.replace(/^claude-/, "");
const here = (...names: string[]) =>
  names.map((name) => ({ name, hostId: "local" }));

describe("managedPanes", () => {
  it("finds a session whose tmux session was renamed", () => {
    const out = managedPanes(
      here("mobile-app-expo", "scratch"),
      [{ id: uuid, tmux_name: "mobile-app-expo", agent_type: "claude" }],
      isManaged,
      idFrom
    );
    expect(out).toEqual([
      {
        name: "mobile-app-expo",
        hostId: "local",
        id: uuid,
        agentType: "claude",
      },
    ]);
  });

  it("still takes provider-uuid names the database doesn't list", () => {
    expect(
      managedPanes(here(`claude-${uuid}`), [], isManaged, idFrom).map(
        (p) => p.id
      )
    ).toEqual([uuid]);
  });

  it("ignores tmux sessions that aren't AgentOS's", () => {
    expect(
      managedPanes(here("work", "aos-chat-x"), [], isManaged, idFrom)
    ).toEqual([]);
  });

  it("matches a row only on its own machine", () => {
    const out = managedPanes(
      [
        { name: "main", hostId: "local" },
        { name: "main", hostId: "box" },
      ],
      [{ id: uuid, tmux_name: "main", agent_type: "claude", host_id: "box" }],
      isManaged,
      idFrom
    );
    expect(out).toEqual([
      { name: "main", hostId: "box", id: uuid, agentType: "claude" },
    ]);
  });
});

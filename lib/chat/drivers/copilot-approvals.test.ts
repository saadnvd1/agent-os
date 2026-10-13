import { describe, expect, it } from "vitest";
import type { ChatAccess, DriverEvent } from "../events";
import { CopilotApprovals } from "./copilot-approvals";

const OPTIONS = [
  { optionId: "allow_once", kind: "allow_once" },
  { optionId: "allow_always", kind: "allow_always" },
  { optionId: "reject_once", kind: "reject_once" },
];

const ask = (kind: string, rawInput: object = {}) => ({
  sessionId: "s",
  options: OPTIONS,
  toolCall: { toolCallId: "c1", title: "Do it", kind, rawInput },
});

function setup(access: ChatAccess) {
  const events: DriverEvent[] = [];
  return {
    approvals: new CopilotApprovals((e) => events.push(e), access),
    events,
  };
}

const picked = (r: unknown) =>
  (r as { outcome: { outcome: string; optionId?: string } }).outcome;

describe("CopilotApprovals", () => {
  it("lets everything through under full access without a card", async () => {
    const { approvals, events } = setup("full");
    const r = await approvals.handle(ask("execute", { command: "rm x" }));
    expect(picked(r)).toEqual({ outcome: "selected", optionId: "allow_once" });
    expect(events).toEqual([]);
  });

  it("lets edits through but asks about a command under edits access", async () => {
    const { approvals, events } = setup("edits");
    expect(picked(await approvals.handle(ask("edit")))).toMatchObject({
      optionId: "allow_once",
    });
    const pending = approvals.handle(ask("execute", { command: "git push" }));
    const card = events.find((e) => e.type === "item");
    expect(card).toMatchObject({
      item: { kind: "approval", toolName: "Bash", status: "pending" },
    });
    approvals.pending.respond("approval-c1", { decision: "deny" });
    expect(picked(await pending)).toMatchObject({ optionId: "reject_once" });
  });

  it("answers always with the always option, and cancels an expired card", async () => {
    const { approvals } = setup("ask");
    const first = approvals.handle(ask("fetch", { url: "https://x.dev" }));
    approvals.pending.respond("approval-c1", { decision: "always" });
    expect(picked(await first)).toMatchObject({ optionId: "allow_always" });
    const second = approvals.handle(ask("execute", { command: "ls" }));
    approvals.pending.expireAll();
    expect(picked(await second)).toEqual({ outcome: "cancelled" });
  });

  it("follows an access change made mid-conversation", async () => {
    const { approvals } = setup("ask");
    approvals.access = "full";
    expect(picked(await approvals.handle(ask("execute")))).toMatchObject({
      optionId: "allow_once",
    });
  });
});

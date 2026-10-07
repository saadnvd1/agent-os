import { describe, expect, it } from "vitest";
import type { DriverEvent } from "../events";
import { CodexApprovals } from "./codex-approvals";
import type { ApprovalOutcome } from "./pending-approvals";

// Answers the one card a request raises, and returns Codex's reply.
async function reply(
  method: string,
  params: Record<string, unknown>,
  answer: ApprovalOutcome
) {
  const events: DriverEvent[] = [];
  const approvals = new CodexApprovals((e) => events.push(e));
  const pending = approvals.handle(method, { itemId: "i1", ...params });
  const card = events.find(
    (e) => e.type === "item" && e.item.kind === "approval"
  );
  if (card?.type !== "item") throw new Error("no card");
  if (answer.decision === "expired") approvals.pending.expireAll();
  else approvals.pending.respond(card.item.id, answer);
  return pending;
}

const command = "item/commandExecution/requestApproval";

describe("CodexApprovals refusals", () => {
  it("declines a refused command, and cancels one the conversation ended on", async () => {
    expect(
      await reply(command, { command: "rm x" }, { decision: "deny" })
    ).toEqual({
      decision: "decline",
    });
    expect(
      await reply(command, { command: "rm x" }, { decision: "expired" })
    ).toEqual({
      decision: "cancel",
    });
    expect(
      await reply("item/fileChange/requestApproval", {}, { decision: "deny" })
    ).toEqual({ decision: "decline" });
  });

  it("grants no extra permissions unless allowed, and only for the turn", async () => {
    const permissions = { network: { enabled: true } };
    const method = "item/permissions/requestApproval";
    expect(await reply(method, { permissions }, { decision: "deny" })).toEqual({
      permissions: {},
      scope: "turn",
    });
    expect(await reply(method, { permissions }, { decision: "allow" })).toEqual(
      {
        permissions,
        scope: "turn",
      }
    );
    expect(
      await reply(method, { permissions }, { decision: "always" })
    ).toEqual({
      permissions,
      scope: "session",
    });
  });

  it("answers questions by id, and with nothing when skipped", async () => {
    const questions = [
      {
        id: "q1",
        header: "H",
        question: "Which?",
        options: [{ label: "A", description: "" }],
      },
    ];
    const method = "item/tool/requestUserInput";
    expect(
      await reply(
        method,
        { questions },
        { decision: "answer", answers: { "Which?": "A" } }
      )
    ).toEqual({ answers: { q1: { answers: ["A"] } } });
    expect(await reply(method, { questions }, { decision: "deny" })).toEqual({
      answers: {},
    });
  });

  it("uses the v1 words for the legacy requests", async () => {
    expect(
      await reply("execCommandApproval", { callId: "c" }, { decision: "deny" })
    ).toEqual({
      decision: "denied",
    });
    expect(
      await reply(
        "applyPatchApproval",
        { callId: "c" },
        { decision: "expired" }
      )
    ).toEqual({
      decision: "abort",
    });
  });
});

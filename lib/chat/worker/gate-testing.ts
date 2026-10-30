/**
 * For tests: a real chat worker (ChatHost) over a fake agent, with the guest
 * gate's PreToolUse hook driven as the SDK would and real approval cards.
 * A test file mocks the drivers with this module's `drivers`:
 *   vi.mock("@/lib/chat/drivers", async () => (await import("@/lib/chat/worker/gate-testing")).drivers)
 */

import { randomUUID } from "crypto";
import { vi } from "vitest";
import type { HookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
import type { Session } from "@/lib/db";
import type { ChatConversation, ChatStartOptions } from "../driver";
import type { ChatItem, DriverEvent } from "../events";
import { InputQueue } from "../queue";
import { Approvals, preToolUseHooks } from "../drivers/claude-approvals";
import type { WorkerEvent } from "./protocol";

export function fakeConversation() {
  const events = new InputQueue<DriverEvent>();
  return {
    send: vi.fn(() => "checkpoint-1"),
    runLocal: vi.fn(() => null),
    interrupt: vi.fn(async () => {}),
    setModel: vi.fn(async () => {}),
    setAccess: vi.fn(async () => {}),
    setPlan: vi.fn(async () => {}),
    respond: vi.fn(),
    stopTask: vi.fn(async () => {}),
    backgroundTask: vi.fn(async () => true),
    undo: vi.fn(),
    close: vi.fn(() => events.end()),
    events,
  } satisfies ChatConversation;
}

const fake: {
  current?: ReturnType<typeof fakeConversation>;
  started?: ChatStartOptions;
} = {};

export const drivers = {
  chatDriverFor: () => ({
    id: "fake",
    atRest: true,
    start: (options: ChatStartOptions) => {
      fake.started = options;
      return fake.current!;
    },
  }),
};

export const tick = () => new Promise((r) => setTimeout(r, 0));

// The host is imported late: it imports the drivers, which this module mocks.
export async function gatedHost(
  session: Session,
  cwd: string,
  onEvent: (e: WorkerEvent) => void = () => {}
) {
  const { ChatHost } = await import("./host");
  fake.current = fakeConversation();
  const conversation = fake.current;
  const emitted: ChatItem[] = [];
  const host = new ChatHost(session, (e) => {
    if (e.type === "item") emitted.push(e.item);
    onEvent(e);
  });
  const approvals = new Approvals((e) => conversation.events.push(e));
  conversation.respond.mockImplementation((cardId, answer) =>
    approvals.respond(cardId, answer)
  );
  const gate = fake.started!.guestGate!;
  const [first] = preToolUseHooks(approvals, undefined, null, { gate, cwd });
  const hook = first.hooks[0];
  const results = new Map<string, HookJSONOutput>();
  const call = (tool: string, input: Record<string, unknown>) => {
    const useId = `tu-${randomUUID().slice(0, 8)}`;
    const ac = new AbortController();
    void hook(
      {
        hook_event_name: "PreToolUse",
        tool_name: tool,
        tool_input: input,
        tool_use_id: useId,
        session_id: "x",
        transcript_path: "",
        cwd,
      } as never,
      useId,
      { signal: ac.signal }
    ).then((r) => results.set(useId, r));
    return { useId, abort: () => ac.abort() };
  };
  /** allow, deny, none (no decision), or pending (still waiting on the host). */
  const decision = async (useId: string) => {
    try {
      await gate.placedFiles(cwd);
    } catch {
      // A test that makes it throw.
    }
    await tick();
    await tick();
    const r = results.get(useId) as
      { hookSpecificOutput?: { permissionDecision?: string } } | undefined;
    return (
      r?.hookSpecificOutput?.permissionDecision ?? (r ? "none" : "pending")
    );
  };
  const card = (useId: string) =>
    emitted
      .filter(
        (i): i is Extract<ChatItem, { kind: "approval" }> =>
          i.kind === "approval" && i.id === `approval-${useId}`
      )
      .at(-1);
  const idle = async () => {
    conversation.events.push({ type: "state", state: "idle" });
    await tick();
  };
  return {
    host,
    gate,
    approvals,
    conversation,
    call,
    decision,
    card,
    idle,
    emitted,
  };
}

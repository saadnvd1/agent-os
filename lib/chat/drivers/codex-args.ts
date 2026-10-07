import type { ChatStartOptions } from "../driver";
import type { ChatAccess, ChatImage } from "../events";
import { AGENT_DEFAULT_MODEL } from "../../providers/registry";
import type { CodexRpc } from "./codex-rpc";

type P = Record<string, unknown>;

// What Codex may do without asking, as its approval policy and sandbox
// (kebab-case when a thread starts, an object on each turn).
export const CODEX_MODES: Record<
  ChatAccess,
  { approvalPolicy: string; sandbox: string; sandboxPolicy: { type: string } }
> = {
  // Asks before anything not known to be safe; what's approved may write
  // in the workspace (a read-only sandbox would refuse it and ask again).
  ask: {
    approvalPolicy: "untrusted",
    sandbox: "workspace-write",
    sandboxPolicy: { type: "workspaceWrite" },
  },
  edits: {
    approvalPolicy: "on-request",
    sandbox: "workspace-write",
    sandboxPolicy: { type: "workspaceWrite" },
  },
  full: {
    approvalPolicy: "never",
    sandbox: "danger-full-access",
    sandboxPolicy: { type: "dangerFullAccess" },
  },
};

export function codexInput(text: string, images?: ChatImage[]) {
  return [
    ...(images ?? []).map((i) => ({
      type: "image",
      url: `data:${i.mediaType};base64,${i.data}`,
    })),
    { type: "text", text },
  ];
}

export const modelOf = (m: string) =>
  m && m !== AGENT_DEFAULT_MODEL ? m : undefined;

export function threadParams(o: ChatStartOptions, access: ChatAccess) {
  return {
    cwd: o.cwd,
    model: modelOf(o.model),
    approvalPolicy: CODEX_MODES[access].approvalPolicy,
    sandbox: CODEX_MODES[access].sandbox,
    developerInstructions: o.systemAppend || undefined,
    // The todo list is opt-in since 0.152.
    config: { "tools.update_plan.enabled": true },
  };
}

// What Codex says when it has no record of a thread (0.156: "no rollout
// found for thread id …").
export const THREAD_GONE = /no rollout found|thread not found|unknown thread/i;

// Opens the conversation: the one it continues when it can, a new one when
// it can't (archived ones are brought back first).
export async function openThread(
  rpc: CodexRpc,
  o: ChatStartOptions,
  access: ChatAccess
) {
  const params = threadParams(o, access);
  if (o.resumeId) {
    const resume = () =>
      rpc.request<{ thread: P }>("thread/resume", {
        ...params,
        threadId: o.resumeId,
        excludeTurns: true,
      });
    try {
      return { thread: (await resume()).thread };
    } catch (error) {
      const why = (error as Error).message;
      if (/archived/i.test(why)) {
        await rpc.request("thread/unarchive", { threadId: o.resumeId });
        return { thread: (await resume()).thread };
      }
      // Anything but gone (a timeout, a passing error) fails this start and
      // keeps the id, so the next start tries the same conversation again.
      if (!THREAD_GONE.test(why)) throw error;
      // Gone (its file deleted, never written): a new one, said so, and
      // saved in its place so the next start doesn't fail the same way.
      const { thread } = await rpc.request<{ thread: P }>(
        "thread/start",
        params
      );
      return {
        thread,
        note: `Couldn't continue the earlier Codex conversation (${why}), so this is a new one.`,
      };
    }
  }
  return {
    thread: (await rpc.request<{ thread: P }>("thread/start", params)).thread,
  };
}

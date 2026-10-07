import type { ChatConversation, ChatDriver, ChatStartOptions } from "../driver";
import type { ChatAccess, ChatImage, DriverEvent } from "../events";
import { InputQueue } from "../queue";
import { AGENT_DEFAULT_MODEL } from "../../providers/registry";
import { CodexApprovals } from "./codex-approvals";
import { CodexMapper } from "./codex-mapper";
import { CodexRpc } from "./codex-rpc";

type P = Record<string, unknown>;

// What Codex may do without asking, as its approval policy and sandbox
// (kebab-case when a thread starts, an object on each turn).
export const CODEX_MODES: Record<
  ChatAccess,
  { approvalPolicy: string; sandbox: string; sandboxPolicy: { type: string } }
> = {
  ask: {
    approvalPolicy: "untrusted",
    sandbox: "read-only",
    sandboxPolicy: { type: "readOnly" },
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

const modelOf = (m: string) => (m && m !== AGENT_DEFAULT_MODEL ? m : undefined);

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

// Opens the conversation: the one it continues when it can, a new one when
// it can't (archived ones are brought back first).
async function openThread(
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
      return (await resume()).thread;
    } catch (error) {
      if (!/archived/i.test((error as Error).message)) throw error;
      await rpc.request("thread/unarchive", { threadId: o.resumeId });
      return (await resume()).thread;
    }
  }
  return (await rpc.request<{ thread: P }>("thread/start", params)).thread;
}

export const codexDriver: ChatDriver = {
  id: "codex",
  plan: false,
  inProcessTools: false,

  async discover({ cwd, env }) {
    const rpc = new CodexRpc(
      { cwd, env: { ...process.env, ...env } },
      { notify: () => {}, request: () => {}, exit: () => {} }
    );
    try {
      await rpc.initialize();
      const r = await rpc.request<{ data: P[] }>("model/list", {});
      return {
        commands: [],
        models: (r.data ?? [])
          .filter((m) => !m.hidden)
          .map((m) => ({
            value: String(m.model ?? m.id),
            label: String(m.displayName ?? m.model ?? m.id),
            description: (m.description as string) || undefined,
          })),
      };
    } finally {
      rpc.close();
    }
  },

  start(options): ChatConversation {
    const out = new InputQueue<DriverEvent>();
    const emit = (e: DriverEvent) => out.push(e);
    const mapper = new CodexMapper(emit);
    const approvals = new CodexApprovals(emit);
    let access = options.access;
    let model = modelOf(options.model);
    let threadId: string | null = null;
    // A message that can't join the running turn waits for it to end.
    let afterStop: { text: string; images?: ChatImage[] } | null = null;
    // Asked for, and not yet started: Codex can't stop a turn before then.
    let starting = false;
    let stopOnStart = false;
    const rpc: CodexRpc = new CodexRpc(
      { cwd: options.cwd, env: { ...process.env, ...options.env } },
      {
        notify(method, params) {
          if (method === "item/started") approvals.sawItem(params.item as P);
          mapper.map(method, params);
          if (method === "turn/started") {
            starting = false;
            if (stopOnStart) {
              stopOnStart = false;
              void stop().catch(fail);
            }
          }
          if (method === "turn/completed" && afterStop) {
            const next = afterStop;
            afterStop = null;
            void startTurn(next.text, next.images);
          }
        },
        request(id, method, params) {
          void approvals.handle(method, params).then((result) => {
            if (result === undefined)
              rpc.replyError(id, `${method} isn't supported`);
            else rpc.reply(id, result);
          });
        },
        exit(error) {
          approvals.pending.expireAll();
          mapper.items.endTurn({ error });
          out.end();
        },
      }
    );
    emit({
      type: "usage_start",
      totals: {
        costUsd: 0,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      },
    });
    const ready = rpc.initialize().then(async () => {
      const thread = await openThread(rpc, options, access);
      threadId = String(thread.id);
      emit({ type: "resume_id", id: threadId });
    });
    ready.catch((error: Error) => {
      mapper.items.error(`Codex couldn't start: ${error.message}`);
      out.end();
      rpc.close();
    });

    async function startTurn(text: string, images?: ChatImage[]) {
      starting = true;
      try {
        await ready;
        const mode = CODEX_MODES[access];
        await rpc.request("turn/start", {
          threadId,
          input: codexInput(text, images),
          model,
          approvalPolicy: mode.approvalPolicy,
          approvalsReviewer: "user",
          sandboxPolicy: mode.sandboxPolicy,
          summary: "detailed",
        });
      } catch (error) {
        starting = false;
        throw error;
      }
    }

    async function stop() {
      if (mapper.activeTurn)
        await rpc.request("turn/interrupt", {
          threadId,
          turnId: mapper.activeTurn,
        });
      else if (starting) stopOnStart = true;
    }

    const fail = (error: Error) => mapper.items.error(error.message);

    return {
      send(text, images, sendOptions) {
        const turn = mapper.activeTurn;
        if (!turn && !starting) {
          void startTurn(text, images).catch(fail);
        } else if (sendOptions?.now || !turn) {
          afterStop = { text, images };
          if (sendOptions?.now) void stop().catch(fail);
        } else {
          // Folded into the running turn, as the agent's next input.
          void rpc
            .request("turn/steer", {
              threadId,
              expectedTurnId: turn,
              input: codexInput(text, images),
            })
            .catch(() => {
              if (mapper.activeTurn) afterStop = { text, images };
              else void startTurn(text, images).catch(fail);
            });
        }
        return undefined;
      },
      async interrupt() {
        afterStop = null;
        await stop();
      },
      async setModel(next) {
        model = modelOf(next);
      },
      async setAccess(next) {
        access = next;
      },
      async setPlan() {},
      respond(id, answer) {
        approvals.pending.respond(id, answer);
      },
      async stopTask() {},
      async undo() {
        return {
          canUndo: false,
          error: "Codex can't undo from chat",
          files: [],
        };
      },
      close() {
        approvals.pending.expireAll();
        rpc.close();
        out.end();
      },
      events: out,
    };
  },
};

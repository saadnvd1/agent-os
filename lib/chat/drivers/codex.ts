import type { ChatConversation, ChatDriver } from "../driver";
import type { ChatImage, DriverEvent } from "../events";
import { InputQueue } from "../queue";
import { CODEX_MODES, codexInput, modelOf, openThread } from "./codex-args";
import { CodexApprovals } from "./codex-approvals";
import { CodexMapper } from "./codex-mapper";
import { CodexRpc } from "./codex-rpc";

type P = Record<string, unknown>;

export const codexDriver: ChatDriver = {
  id: "codex",
  plan: false,
  inProcessTools: false,
  atRest: false,

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
    // Messages that can't join the running turn wait for it to end, in order.
    const held: { text: string; images?: ChatImage[] }[] = [];
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
          if (method === "turn/completed" && held.length) {
            const next = held.shift()!;
            void startTurn(next.text, next.images).catch(fail);
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
      const { thread, note } = await openThread(rpc, options, access);
      if (note) mapper.items.error(note);
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
          held.push({ text, images });
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
              if (mapper.activeTurn) held.push({ text, images });
              else void startTurn(text, images).catch(fail);
            });
        }
        return undefined;
      },
      // Stops the turn only: a message already sent still goes after it.
      async interrupt() {
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

import type { ChatConversation, ChatDriver, ChatStartOptions } from "../driver";
import type { ChatImage, DriverEvent } from "../events";
import { InputQueue } from "../queue";
import { AGENT_DEFAULT_MODEL } from "../../providers/registry";
import { PiAccess, PiDialogs, writeExtension } from "./pi-approvals";
import { PiMapper } from "./pi-mapper";
import { PiRpc } from "./pi-rpc";

type P = Record<string, unknown>;

const SETTLE_TRIES = 5;

export function piArgs(o: ChatStartOptions, extension: string): string[] {
  const args = ["-e", extension];
  // A path, so a conversation started elsewhere never makes Pi ask about it.
  if (o.resumeId) args.push("--session", o.resumeId);
  if (o.model && o.model !== AGENT_DEFAULT_MODEL) args.push("--model", o.model);
  if (o.systemAppend) args.push("--append-system-prompt", o.systemAppend);
  return args;
}

export function piImages(images?: ChatImage[]) {
  return images?.length
    ? images.map((i) => ({
        type: "image",
        data: i.data,
        mimeType: i.mediaType,
      }))
    : undefined;
}

const splitModel = (model: string) => {
  const slash = model.indexOf("/");
  return slash > 0
    ? { provider: model.slice(0, slash), modelId: model.slice(slash + 1) }
    : null;
};

export const piDriver: ChatDriver = {
  id: "pi",
  plan: false,
  inProcessTools: false,

  async discover({ cwd, env }) {
    const rpc = new PiRpc(
      ["--no-session", "--offline"],
      { cwd, env: { ...process.env, ...env } },
      { event: () => {}, ui: () => {}, exit: () => {} }
    );
    try {
      const [models, commands] = await Promise.all([
        rpc.request<{ models: P[] }>("get_available_models"),
        rpc.request<{ commands: P[] }>("get_commands"),
      ]);
      return {
        models: (models.models ?? []).map((m) => ({
          value: `${m.provider}/${m.id}`,
          label: String(m.name ?? m.id),
          description: String(m.provider),
        })),
        commands: (commands.commands ?? []).map((c) => ({
          name: String(c.name),
          description: String(c.description ?? ""),
        })),
      };
    } finally {
      rpc.close();
    }
  },

  start(options): ChatConversation {
    const out = new InputQueue<DriverEvent>();
    const emit = (e: DriverEvent) => out.push(e);
    const mapper = new PiMapper(emit);
    const dialogs = new PiDialogs(emit);
    const access = new PiAccess(options.access);
    // Sent now: goes once the stopped run has ended.
    const held: { text: string; images?: ChatImage[] }[] = [];
    const rpc: PiRpc = new PiRpc(
      piArgs(options, writeExtension()),
      {
        cwd: options.cwd,
        env: {
          ...process.env,
          ...options.env,
          AGENTOS_PI_ACCESS_FILE: access.file,
          PI_OFFLINE: "1",
        },
      },
      {
        event(e) {
          mapper.map(e);
          if (e.type === "agent_end") void settle();
        },
        ui(r) {
          void dialogs.handle(r).then((answer) => {
            if (answer) rpc.answerUi(String(r.id), answer);
          });
        },
        exit(error) {
          dialogs.pending.expireAll();
          mapper.items.endTurn({ error });
          access.remove();
          out.end();
        },
      }
    );
    emit({ type: "usage_start", totals: { ...mapper.totals } });
    void rpc
      .request<P>("get_state")
      .then((s) => {
        const file = s.sessionFile ?? s.sessionId;
        if (file) emit({ type: "resume_id", id: String(file) });
      })
      .catch((error: Error) => mapper.items.error(error.message));

    // A run that ended may have more queued (a message sent mid-run, a
    // retry): the turn ends once Pi says it's idle.
    async function settle() {
      if (!mapper.aborted)
        for (let i = 0; i < SETTLE_TRIES; i++) {
          const s = await rpc.request<P>("get_state").catch(() => null);
          if (!s) break;
          if (s.isStreaming || (s.pendingMessageCount as number) > 0) return;
          if (!s.isCompacting) break;
          await new Promise((r) => setTimeout(r, 200));
        }
      mapper.endTurn();
      void rpc
        .request<{ contextUsage?: P }>("get_session_stats")
        .then((s) => {
          const c = s.contextUsage;
          if (c?.tokens == null || !c.contextWindow) return;
          emit({
            type: "context",
            context: {
              usedTokens: Number(c.tokens),
              maxTokens: Number(c.contextWindow),
              percentage: Math.round(Number(c.percent) * 10) / 10,
              categories: [],
              at: Date.now(),
            },
          });
        })
        .catch(() => {});
    }

    const prompt = (text: string, images?: ChatImage[]) =>
      rpc
        .request("prompt", {
          message: text,
          images: piImages(images),
          // Joins a running run, or starts one.
          streamingBehavior: "steer",
        })
        .catch((error: Error) => {
          mapper.items.error(error.message);
        });

    return {
      send(text, images, sendOptions) {
        if (sendOptions?.now && mapper.items.inTurn) {
          held.push({ text, images });
          // Abort answers once the run has stopped; what was held goes then.
          void rpc
            .request("abort", {}, 0)
            .catch((error: Error) => mapper.items.error(error.message))
            .then(() => {
              for (const next of held.splice(0))
                void prompt(next.text, next.images);
            });
        } else void prompt(text, images);
        return undefined;
      },
      // Stops the run only: a message already sent still goes after it.
      async interrupt() {
        await rpc.request("abort", {}, 0);
      },
      async setModel(model) {
        const m = splitModel(model);
        if (m) await rpc.request("set_model", m);
      },
      async setAccess(next) {
        access.set(next);
      },
      async setPlan() {},
      respond(id, answer) {
        dialogs.pending.respond(id, answer);
      },
      async stopTask() {},
      async undo() {
        return { canUndo: false, error: "Pi can't undo from chat", files: [] };
      },
      close() {
        dialogs.pending.expireAll();
        rpc.close();
        out.end();
      },
      events: out,
    };
  },
};

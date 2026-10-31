import { sessionBaseEnv } from "../../agents/server-env";
import type { ChatConversation, ChatDriver, ChatStartOptions } from "../driver";
import type { ChatImage, DriverEvent } from "../events";
import { InputQueue } from "../queue";
import { AGENT_DEFAULT_MODEL } from "../../providers/registry";
import { PiAccess, PiDialogs, writeExtension } from "./pi-approvals";
import { TEXT_TOOLS_EXTENSION } from "./pi-text-tools";
import { PiMapper } from "./pi-mapper";
import { writePiEditGuard } from "./pi-edit-guard";
import { typescriptPath } from "./edit-guard";
import { continuePrompt, type RetryDecision } from "./transient-retry";
import { PiRpc } from "./pi-rpc";
import { RESULTS_BRIEF, SUMMARY_NUDGE } from "./turn-outcome";

type P = Record<string, unknown>;

const SETTLE_TRIES = 5;
// Compacting can take a while; the retry waits for it.
const COMPACT_MS = 300_000;

export function piArgs(o: ChatStartOptions, ...extensions: string[]): string[] {
  const args = extensions.flatMap((e) => ["-e", e]);
  // A path, so a conversation started elsewhere never makes Pi ask about it.
  if (o.resumeId) args.push("--session", o.resumeId);
  if (o.model && o.model !== AGENT_DEFAULT_MODEL) args.push("--model", o.model);
  args.push(
    "--append-system-prompt",
    [o.systemAppend, RESULTS_BRIEF].filter(Boolean).join("\n\n")
  );
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

// The edit guard extension, or none where it can't be written.
function guardExtension(): string[] {
  try {
    return [writePiEditGuard()];
  } catch {
    return [];
  }
}

export const piDriver: ChatDriver = {
  id: "pi",
  plan: false,
  inProcessTools: false,
  atRest: false,

  async discover({ cwd, env }) {
    const rpc = new PiRpc(
      ["--no-session", "--offline"],
      { cwd, env: { ...sessionBaseEnv(), ...env } },
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
          group: String(m.provider),
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
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    // Bumped when a retry is cancelled, so one already under way stops.
    let retryGen = 0;
    let closed = false;
    const mapper = new PiMapper(emit, (d, error) => scheduleRetry(d, error));
    const dialogs = new PiDialogs(emit);
    const access = new PiAccess(options.access);
    // Sent now: goes once the stopped run has ended.
    let nudged = false;
    const held: { text: string; images?: ChatImage[] }[] = [];
    const rpc: PiRpc = new PiRpc(
      piArgs(
        options,
        ...guardExtension(),
        writeExtension(),
        writeExtension("agentos-text-tools.mjs", TEXT_TOOLS_EXTENSION)
      ),
      {
        cwd: options.cwd,
        env: {
          ...sessionBaseEnv(),
          ...options.env,
          AGENTOS_PI_ACCESS_FILE: access.file,
          ...(typescriptPath() && { AGENTOS_TYPESCRIPT: typescriptPath() }),
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
          cancelRetry();
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
      if (!nudged && mapper.needsSummary()) {
        nudged = true;
        console.info("[chat] asked the model for its results summary");
        void prompt(SUMMARY_NUDGE);
        return;
      }
      nudged = false;
      mapper.endTurn();
      void rpc
        .request<{ contextUsage?: P }>("get_session_stats")
        .then((s) => {
          const c = s.contextUsage;
          if (c?.tokens == null || !c.contextWindow) return;
          mapper.contextPercent = Number(c.percent) || 0;
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

    // The failed request goes again after its wait, on a compacted context
    // for the last try. Stopping or closing cancels it.
    function scheduleRetry(
      d: Extract<RetryDecision, { retry: true }>,
      error: string
    ) {
      cancelRetry();
      const gen = retryGen;
      retryTimer = setTimeout(() => {
        retryTimer = null;
        void resume(d, error, gen);
      }, d.delayMs);
    }

    // Whether a retry was waiting or under way.
    function cancelRetry(): boolean {
      const pending = retryTimer !== null || mapper.retrying;
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = null;
      retryGen++;
      return pending;
    }

    async function resume(
      d: Extract<RetryDecision, { retry: true }>,
      error: string,
      gen: number
    ) {
      const live = () => !closed && mapper.retrying && gen === retryGen;
      if (!live()) return;
      if (d.compactFirst) {
        await rpc.request("compact", {}, COMPACT_MS).catch(() => {});
        if (!live()) return;
      }
      mapper.retrying = false;
      await prompt(continuePrompt(error), undefined, true);
    }

    const prompt = (text: string, images?: ChatImage[], retried = false) => {
      if (!retried) {
        cancelRetry();
        mapper.userPrompt();
      }
      return rpc
        .request("prompt", {
          message: text,
          images: piImages(images),
          // Joins a running run, or starts one.
          streamingBehavior: "steer",
        })
        .catch((error: Error) => {
          mapper.items.error(error.message);
        });
    };

    // A turn waiting to retry has nothing running to abort: it ends here.
    function stopWaiting(): boolean {
      if (!cancelRetry()) return false;
      mapper.stopRetrying();
      return true;
    }

    return {
      send(text, images, sendOptions) {
        if (sendOptions?.now && mapper.items.inTurn) {
          if (stopWaiting()) {
            void prompt(text, images);
            return undefined;
          }
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
        if (stopWaiting()) return;
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
        closed = true;
        cancelRetry();
        dialogs.pending.expireAll();
        rpc.close();
        out.end();
      },
      events: out,
    };
  },
};

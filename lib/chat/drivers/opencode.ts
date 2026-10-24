import { sessionBaseEnv } from "../../agents/server-env";
import type { ChatConversation, ChatDriver } from "../driver";
import type { ChatImage, DriverEvent } from "../events";
import { InputQueue } from "../queue";
import { AGENT_DEFAULT_MODEL } from "../../providers/registry";
import { OpenCodeMapper } from "./opencode-mapper";
import { openCodeRules } from "./opencode-rules";
import { OpenCodeServer } from "./opencode-server";
import { OpenCodeApprovals } from "./opencode-approvals";
import { RESULTS_BRIEF, SUMMARY_NUDGE } from "./turn-outcome";
import { openCodeConfigContent, STALL_MS } from "./opencode-config";
import { writeOpenCodeGuard } from "./opencode-plugin";
import { typescriptPath } from "./edit-guard";
import { continuePrompt, type RetryDecision } from "./transient-retry";

type P = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" ? v : "");

// Compacting can take a while; the retry waits for it.
const COMPACT_MS = 300_000;

// The server's environment for one conversation: the edit guard plugin, a
// longer header wait for its providers, and the TypeScript to check syntax
// with. Where any of it can't be set up the conversation runs without it.
function conversationEnv(
  cwd: string,
  model: string,
  env: NodeJS.ProcessEnv
): NodeJS.ProcessEnv {
  try {
    const ts = typescriptPath();
    const withTs = { ...env, ...(ts && { AGENTOS_TYPESCRIPT: ts }) };
    return {
      ...withTs,
      OPENCODE_CONFIG_CONTENT: openCodeConfigContent({
        cwd,
        env: withTs,
        model,
        pluginFile: writeOpenCodeGuard(),
      }),
    };
  } catch {
    return env;
  }
}

// How often a waiting turn is checked for silence.
const WATCH_MS = 30_000;

// How long a prompt may go without the session turning busy before the
// turn is checked on.
const ADMIT_MS = 15_000;

// AgentOS's own brief, then the results line every session gets.
export function openCodeSystem(append?: string): string {
  return [append, RESULTS_BRIEF].filter(Boolean).join("\n\n");
}

export function openCodeModel(model: string) {
  const slash = model.indexOf("/");
  if (!model || model === AGENT_DEFAULT_MODEL || slash < 1) return undefined;
  return { providerID: model.slice(0, slash), modelID: model.slice(slash + 1) };
}

export function openCodeParts(text: string, images?: ChatImage[]) {
  return [
    { type: "text", text },
    ...(images ?? []).map((i, n) => ({
      type: "file",
      mime: i.mediaType,
      filename: `image-${n + 1}.${i.mediaType.split("/")[1] ?? "png"}`,
      url: `data:${i.mediaType};base64,${i.data}`,
    })),
  ];
}

// A model that can run a coding turn: speech, image and embedding models
// can't call tools or answer in text.
const canChat = (m: P) => {
  const c = (m.capabilities ?? {}) as P;
  return c.toolcall !== false && (c.output as P | undefined)?.text !== false;
};

export const openCodeDriver: ChatDriver = {
  id: "opencode",
  plan: true,
  inProcessTools: false,
  atRest: false,

  async discover({ cwd, env }) {
    const server = new OpenCodeServer(cwd, { ...sessionBaseEnv(), ...env });
    try {
      const [providers, commands] = await Promise.all([
        server.call<{ all: P[]; connected: string[] }>("GET", "/provider"),
        server.call<P[]>("GET", "/command"),
      ]);
      const connected = new Set(providers.connected ?? []);
      return {
        models: (providers.all ?? [])
          .filter((p) => connected.has(str(p.id)))
          .flatMap((p) =>
            Object.values((p.models ?? {}) as Record<string, P>)
              .filter(canChat)
              .map((m) => ({
                value: `${p.id}/${m.id}`,
                label: str(m.name) || str(m.id),
                description: str(p.name) || str(p.id),
              }))
          ),
        commands: (commands ?? []).map((c) => ({
          name: str(c.name),
          description: str(c.description),
        })),
      };
    } finally {
      server.close();
    }
  },

  start(options): ChatConversation {
    const out = new InputQueue<DriverEvent>();
    const emit = (e: DriverEvent) => out.push(e);
    const server = new OpenCodeServer(
      options.cwd,
      conversationEnv(options.cwd, options.model ?? "", {
        ...sessionBaseEnv(),
        ...options.env,
      })
    );
    let sessionId: string | null = null;
    const children = new Set<string>();
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    // Bumped when a retry is cancelled, so one already under way stops.
    let retryGen = 0;
    const mapper = new OpenCodeMapper(
      () => sessionId,
      emit,
      (d, error) => scheduleRetry(d, error)
    );
    const approvals = new OpenCodeApprovals(emit, server, (e) => fail(e));
    let access = options.access;
    let plan = !!options.plan;
    let model = openCodeModel(options.model);
    // Sent now: each goes, in order, once the stopped turn has ended.
    const held: { text: string; images?: ChatImage[] }[] = [];
    const stream = new AbortController();
    let closed = false;
    // A turn silent for STALL_MS (an env override is for tests only) is
    // stopped: OpenCode's own retries could wait for hours.
    const stallMs = Number(process.env.AGENTOS_OPENCODE_STALL_MS) || STALL_MS;
    const watchdog = setInterval(
      () => {
        const silent = mapper.silentMs();
        if (silent < stallMs) return;
        cancelRetry();
        mapper.stalled(silent);
        void abort();
      },
      Math.min(WATCH_MS, stallMs / 2)
    );
    watchdog.unref();

    const fail = (error: Error) => mapper.items.error(error.message);
    const ours = (id: unknown) => id === sessionId || children.has(str(id));

    function onEvent(e: P) {
      const p = (e.properties ?? {}) as P;
      const info = p.info as P | undefined;
      if (e.type === "session.created" && info && ours(info.parentID))
        children.add(str(info.id));
      if (ours(p.sessionID)) approvals.handle(e.type, p);
      const wasInTurn = mapper.items.inTurn;
      mapper.map(e);
      if (mapper.takeNudge()) return void prompt(SUMMARY_NUDGE);
      if (wasInTurn && !mapper.items.inTurn && held.length) {
        const next = held.shift()!;
        void prompt(next.text, next.images);
      }
    }

    // Continues the conversation it was given, or starts one.
    const ready = (async () => {
      void server.events(onEvent, stream.signal).catch(() => {});
      if (options.resumeId) {
        const found = await server
          .call<P>("GET", `/session/${encodeURIComponent(options.resumeId)}`)
          .catch((e: Error & { status?: number }) => {
            if (e.status === 404) return null;
            throw e;
          });
        if (found) sessionId = str(found.id);
      }
      if (!sessionId) {
        const s = await server.call<P>("POST", "/session", {
          permission: openCodeRules(access),
        });
        sessionId = str(s.id);
      } else {
        await setRules();
      }
      emit({ type: "resume_id", id: sessionId });
    })();
    ready.catch((error: Error) => {
      mapper.items.error(`OpenCode couldn't start: ${error.message}`);
      close();
    });
    server.onExit((error) => {
      if (closed) return;
      approvals.pending.expireAll();
      mapper.items.endTurn({ error });
      close();
    });
    emit({ type: "usage_start", totals: { ...mapper.totals } });

    // Changing rules adds to them, and the last match wins: send them all.
    function setRules() {
      return server.call("PATCH", `/session/${sessionId}`, {
        permission: openCodeRules(access),
      });
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
      const live = () => !closed && mapper.items.inTurn && gen === retryGen;
      if (!live()) return;
      if (d.compactFirst && model) {
        mapper.holdIdle(true);
        await server
          .call("POST", `/session/${sessionId}/summarize`, model, COMPACT_MS)
          .catch(() => {});
        mapper.holdIdle(false);
        if (!live()) return;
      }
      await prompt(continuePrompt(error), undefined, true);
    }

    async function prompt(text: string, images?: ChatImage[], retried = false) {
      if (!retried) cancelRetry();
      mapper.prompted(retried);
      try {
        await ready;
        await server.call("POST", `/session/${sessionId}/prompt_async`, {
          model,
          agent: plan ? "plan" : "build",
          system: openCodeSystem(options.systemAppend),
          parts: retried
            ? [{ type: "text", text, synthetic: true }]
            : openCodeParts(text, images),
        });
      } catch (error) {
        fail(error as Error);
        mapper.settle();
        return;
      }
      setTimeout(() => void admitted().catch(() => {}), ADMIT_MS).unref();
    }

    // No busy since the prompt: if OpenCode says the session is idle, the
    // turn is over.
    async function admitted() {
      if (!mapper.items.inTurn) return;
      const status = await server.call<P>("GET", "/session/status");
      if (!status[sessionId!]) mapper.settle();
    }

    async function abort() {
      // A turn waiting to retry has nothing running to abort: it ends here.
      if (cancelRetry()) {
        mapper.stopRetrying();
        for (const next of held.splice(0)) void prompt(next.text, next.images);
      }
      await ready;
      for (const id of [sessionId, ...children])
        await server.call("POST", `/session/${id}/abort`).catch(() => {});
    }

    function close() {
      if (closed) return;
      closed = true;
      clearInterval(watchdog);
      cancelRetry();
      approvals.pending.expireAll();
      stream.abort();
      server.close();
      out.end();
    }

    return {
      send(text, images, sendOptions) {
        if (sendOptions?.now && mapper.items.inTurn) {
          held.push({ text, images });
          void abort();
        } else void prompt(text, images);
        return undefined;
      },
      // Stops the turn only: a message already sent still goes after it.
      async interrupt() {
        await abort();
      },
      async setModel(next) {
        model = openCodeModel(next);
      },
      async setAccess(next) {
        if (next === access) return;
        access = next;
        await ready;
        await setRules();
      },
      async setPlan(next) {
        plan = next;
      },
      respond(id, answer) {
        approvals.pending.respond(id, answer);
      },
      async stopTask() {},
      async undo() {
        return {
          canUndo: false,
          error: "OpenCode can't undo from chat",
          files: [],
        };
      },
      close,
      events: out,
    };
  },
};

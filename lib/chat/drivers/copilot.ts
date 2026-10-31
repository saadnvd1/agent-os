import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { sessionBaseEnv } from "../../agents/server-env";
import type { ChatConversation, ChatDriver, ChatStartOptions } from "../driver";
import type { ChatImage, ChatModel, DriverEvent } from "../events";
import { InputQueue } from "../queue";
import { AGENT_DEFAULT_MODEL } from "../../providers/registry";
import { CopilotApprovals } from "./copilot-approvals";
import { CopilotMapper } from "./copilot-mapper";
import { CopilotRpc } from "./copilot-rpc";

type P = Record<string, unknown>;

// `copilot --acp` ignores the user's default model (COPILOT_MODEL and
// ~/.copilot/settings.json) and only honours --model, so we pass it on.
export function copilotDefaultModel(
  env: Record<string, string | undefined>,
  readSettings: () => string = () =>
    readFileSync(path.join(os.homedir(), ".copilot", "settings.json"), "utf8")
): string | undefined {
  if (env.COPILOT_MODEL) return env.COPILOT_MODEL;
  try {
    const model = (JSON.parse(readSettings()) as P).model;
    return typeof model === "string" && model ? model : undefined;
  } catch {
    return undefined;
  }
}

export function copilotArgs(
  o: ChatStartOptions,
  fallback = copilotDefaultModel({ ...process.env, ...o.env })
): string[] {
  const model = o.model && o.model !== AGENT_DEFAULT_MODEL ? o.model : fallback;
  return model ? ["--model", model] : [];
}

// The models a new ACP session offers (`models.availableModels`), with
// Copilot's premium-request multiplier as the note when it gives one.
export function copilotModels(session: P | undefined): ChatModel[] {
  const list = ((session?.models as P | undefined)?.availableModels ??
    []) as P[];
  return list
    .filter((m) => typeof m.modelId === "string")
    .map((m) => {
      const meta = (m._meta ?? {}) as P;
      const usage = meta.copilotUsage ?? m.copilotUsage;
      const note =
        typeof usage === "number"
          ? usage === 0
            ? "Included"
            : `${usage}x usage`
          : typeof usage === "string"
            ? usage
            : undefined;
      const description =
        typeof m.description === "string" ? m.description : undefined;
      return {
        value: String(m.modelId),
        label: String(m.name ?? m.modelId),
        ...(note ? { note } : {}),
        ...(description ? { description } : {}),
      };
    });
}

export function copilotPrompt(text: string, images?: ChatImage[]) {
  return [
    { type: "text", text },
    ...(images ?? []).map((i) => ({
      type: "image",
      data: i.data,
      mimeType: i.mediaType,
    })),
  ];
}

// The GitHub Copilot CLI over the Agent Client Protocol (`copilot --acp`).
// It has no system prompt to append to, so the instructions go ahead of the
// first message of a new conversation.
export const copilotDriver: ChatDriver = {
  id: "copilot",
  plan: false,
  inProcessTools: false,
  atRest: false,

  // The ACP server lists models only for a session, so a throwaway one is
  // opened, read and closed.
  async discover({ cwd, env, signal }) {
    const rpc = new CopilotRpc(
      [],
      { cwd, env: { ...sessionBaseEnv(), ...env } },
      {
        notify: () => {},
        request: (id) => rpc.replyError(id, "not supported"),
        exit: () => {},
      }
    );
    const close = () => rpc.close();
    signal?.addEventListener("abort", close);
    try {
      await rpc.initialize();
      const session = await rpc.request<P>("session/new", {
        cwd,
        mcpServers: [],
      });
      return { commands: [], models: copilotModels(session) };
    } finally {
      signal?.removeEventListener("abort", close);
      close();
    }
  },

  start(options): ChatConversation {
    const out = new InputQueue<DriverEvent>();
    const emit = (e: DriverEvent) => out.push(e);
    const mapper = new CopilotMapper(emit);
    const approvals = new CopilotApprovals(emit, options.access);
    let sessionId: string | null = null;
    let busy = false;
    let intro = options.resumeId ? "" : (options.systemAppend ?? "").trim();
    // Messages that can't join the running turn wait for it to end, in order.
    const held: { text: string; images?: ChatImage[] }[] = [];
    const rpc: CopilotRpc = new CopilotRpc(
      copilotArgs(options),
      { cwd: options.cwd, env: { ...sessionBaseEnv(), ...options.env } },
      {
        notify(method, params) {
          if (method === "session/update")
            mapper.map((params.update ?? {}) as P);
        },
        request(id, method, params) {
          if (method !== "session/request_permission")
            return rpc.replyError(id, `${method} isn't supported`);
          void approvals.handle(params).then((result) => rpc.reply(id, result));
        },
        exit(error) {
          approvals.pending.expireAll();
          mapper.endTurn({ error });
          out.end();
        },
      }
    );
    emit({ type: "usage_start", totals: { ...mapper.totals } });

    const ready = rpc.initialize().then(async () => {
      const params = { cwd: options.cwd, mcpServers: [] };
      if (options.resumeId) {
        mapper.replaying = true;
        try {
          await rpc.request("session/load", {
            ...params,
            sessionId: options.resumeId,
          });
          sessionId = options.resumeId;
        } catch {
          mapper.items.error(
            "That conversation is gone, so this one starts over"
          );
          intro = (options.systemAppend ?? "").trim();
        } finally {
          mapper.replaying = false;
        }
      }
      if (!sessionId)
        sessionId = (
          await rpc.request<{ sessionId: string }>("session/new", params)
        ).sessionId;
      emit({ type: "resume_id", id: sessionId });
    });
    ready.catch((error: Error) => {
      mapper.items.error(`GitHub Copilot couldn't start: ${error.message}`);
      mapper.endTurn({});
      out.end();
      rpc.close();
    });

    async function run(text: string, images?: ChatImage[]) {
      busy = true;
      mapper.items.startTurn();
      let end: { interrupted?: boolean; error?: string } = {};
      try {
        await ready;
        const first = intro ? `${intro}\n\n${text}` : text;
        intro = "";
        const r = await rpc.request<P>(
          "session/prompt",
          { sessionId, prompt: copilotPrompt(first, images) },
          0
        );
        mapper.spent(r.usage as P | undefined);
        end = { interrupted: r.stopReason === "cancelled" };
      } catch (error) {
        end = { error: (error as Error).message };
      }
      busy = false;
      mapper.endTurn(end);
      const next = held.shift();
      if (next) void run(next.text, next.images);
    }

    function stop() {
      approvals.pending.expireAll();
      if (busy && sessionId) rpc.notify("session/cancel", { sessionId });
    }

    return {
      send(text, images, sendOptions) {
        if (!busy) void run(text, images);
        else {
          held.push({ text, images });
          if (sendOptions?.now) stop();
        }
        return undefined;
      },
      // Stops the turn only: a message already sent still goes after it.
      async interrupt() {
        stop();
      },
      async setModel(model) {
        const modelId =
          model && model !== AGENT_DEFAULT_MODEL
            ? model
            : copilotDefaultModel({ ...process.env, ...options.env });
        if (!modelId) return;
        await ready;
        await rpc.request("session/set_model", { sessionId, modelId });
      },
      async setAccess(next) {
        approvals.access = next;
      },
      async setPlan() {},
      respond(id, answer) {
        approvals.pending.respond(id, answer);
      },
      async stopTask() {},
      async undo() {
        return {
          canUndo: false,
          error: "GitHub Copilot can't undo from chat",
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

import { randomUUID } from "crypto";
import {
  getSessionMessages,
  query,
  type McpServerStatus,
  type SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import type { ChatDriver, ChatConversation } from "../driver";
import type { DriverEvent, FileSuggestion, McpServerView } from "../events";
import { InputQueue } from "../queue";
import { Approvals, isPlanFile, sdkMode } from "./claude-approvals";
import { toChatContext, usageTotals } from "../context";
import { ClaudeMapper, toCommand, type ClaudeMessage } from "./claude-mapper";
import { redact } from "../../orchestrator/untrusted";

// Claude Code through the Agent SDK, signed in with the user's own Claude
// Code login. Asks for approval through chat cards unless given full access,
// and checkpoints files so a message's changes can be undone.
// The conversation's last entry before a message, so it can continue as if
// the message was never sent.
async function entryBefore(
  sessionId: string,
  cwd: string,
  uuid: string
): Promise<string | null | undefined> {
  const chain = (await getSessionMessages(sessionId, { dir: cwd })).filter(
    (m) => !m.parent_tool_use_id
  );
  const i = chain.findIndex((m) => m.uuid === uuid);
  if (i === -1) return undefined;
  return i === 0 ? null : chain[i - 1].uuid;
}

const firstLine = (text?: string) => {
  const line = text?.trim().split("\n")[0];
  return line
    ? line.length > 160
      ? `${line.slice(0, 159)}…`
      : line
    : undefined;
};

// A server's error text can quote its URL, and with it a key: shown and
// stored redacted, on one line, and short.
const URL_USERINFO = /\b([a-z][a-z0-9+.-]*:\/\/)[^@\s/]+@/gi;
const SECRET_PARAM =
  /([?&][\w.-]*(?:key|token|secret|password|auth|sig|code)[\w.-]*=)[^&\s#]+/gi;
function cleanError(text?: string): string | undefined {
  if (!text) return undefined;
  const line = redact(
    text
      .replace(URL_USERINFO, "$1[redacted]@")
      .replace(SECRET_PARAM, "$1[redacted]")
  )
    .replace(/[\x00-\x1f\x7f]+/g, " ")
    .trim();
  return line.length > 300 ? `${line.slice(0, 299)}…` : line;
}

export function mcpView(s: McpServerStatus): McpServerView {
  return {
    name: s.name,
    status: s.status,
    scope: s.source ?? s.scope,
    version: s.serverInfo?.version,
    error: cleanError(s.error),
    tools: (s.tools ?? []).map((t) => ({
      name: t.name,
      description: firstLine(t.description),
    })),
  };
}

// Claude Code's answer to a file_suggestions request, as files and folders
// (a folder's path ends in "/"). Anything not shaped like that is dropped.
export function toFileSuggestions(response: unknown): FileSuggestion[] {
  const list = (response as { suggestions?: unknown } | undefined)?.suggestions;
  if (!Array.isArray(list)) return [];
  return list
    .map((s) => (s as { path?: unknown } | null)?.path)
    .filter(
      (p): p is string => typeof p === "string" && p.replace(/\/+$/, "") !== ""
    )
    .map((p) =>
      p.endsWith("/")
        ? { path: p.replace(/\/+$/, ""), dir: true }
        : { path: p, dir: false }
    );
}

// Claude Code's own @mention matching, through a control request the SDK
// has no method for.
async function fileSuggestions(
  q: ReturnType<typeof query>,
  text: string
): Promise<FileSuggestion[]> {
  const control = q as unknown as {
    request(r: {
      subtype: "file_suggestions";
      query: string;
    }): Promise<{ response?: unknown }>;
  };
  const r = await control.request({ subtype: "file_suggestions", query: text });
  return toFileSuggestions(r.response);
}

// The plan file an assistant message writes, if it writes one. Only writes
// count: in plan mode the plan file is the one thing the agent may change,
// while a plans folder it merely reads holds someone else's plans.
const WRITES = new Set(["Write", "Edit", "MultiEdit"]);
export function writtenPlanFile(m: ClaudeMessage): string | undefined {
  if (m.type !== "assistant" || !Array.isArray(m.message?.content)) return;
  for (const b of m.message.content) {
    const path = (b.input as { file_path?: unknown } | undefined)?.file_path;
    if (b.type === "tool_use" && WRITES.has(b.name ?? "") && isPlanFile(path))
      return path;
  }
}

export const claudeDriver: ChatDriver = {
  id: "claude",

  // Claude Code reports its commands, skills and models while starting up,
  // before any message, so a short-lived start tells the composer what's
  // available without spending a turn.
  async discover({ cwd, env }) {
    const input = new InputQueue<SDKUserMessage>();
    const q = query({
      prompt: input,
      options: {
        cwd,
        permissionMode: "bypassPermissions",
        allowDangerouslySkipPermissions: true,
        env: { ...process.env, ...env },
      },
    });
    try {
      const init = await q.initializationResult();
      return {
        commands: (init.commands ?? []).map(toCommand),
        models: (init.models ?? []).map((m) => ({
          value: m.value,
          label: m.displayName,
          description: m.description,
        })),
      };
    } finally {
      input.end();
      q.close();
    }
  },

  start(options): ChatConversation {
    const input = new InputQueue<SDKUserMessage>();
    const out = new InputQueue<DriverEvent>();
    let planFile: string | undefined;
    const approvals = new Approvals(
      (e) => out.push(e),
      () => planFile
    );
    let access = options.access;
    let plan = !options.permissionMode && !!options.plan;
    const q = query({
      prompt: input,
      options: {
        cwd: options.cwd,
        model: options.model,
        resume: options.resumeId ?? undefined,
        resumeSessionAt: options.resumeAt ?? undefined,
        permissionMode: options.permissionMode ?? sdkMode(access, plan),
        allowDangerouslySkipPermissions: true,
        canUseTool: approvals.canUseTool,
        mcpServers: options.mcpServers,
        allowedTools: options.allowedTools,
        disallowedTools: options.disallowedTools,
        hooks: {
          PreToolUse: [
            {
              matcher: "AskUserQuestion",
              hooks: [approvals.askQuestions],
              // The reader may take a while to answer.
              timeout: 24 * 60 * 60,
            },
            { matcher: "ExitPlanMode", hooks: [approvals.proposePlan] },
          ],
        },
        enableFileCheckpointing: true,
        includePartialMessages: true,
        // Each background task has its own Stop, so Stop on the turn spares
        // them.
        perTaskStopAffordance: true,
        // A guess at the next message after each turn (not the first, nor
        // in plan mode), sent after the result.
        promptSuggestions: true,
        systemPrompt: {
          type: "preset",
          preset: "claude_code",
          append: options.systemAppend,
        },
        env: { ...process.env, ...options.env },
      },
    });
    const mapper = new ClaudeMapper();
    let sessionId = options.resumeId ?? null;

    // What the agent restored on starting: a resumed conversation's totals
    // when its last process saved them, nothing otherwise. Each turn's cost
    // is measured from here.
    void q
      .usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({
        skipBehaviors: true,
      })
      .then((u) =>
        out.push({
          type: "usage_start",
          totals: usageTotals(u.session.model_usage, u.session.total_cost_usd),
        })
      )
      .catch(() => {});

    void (async () => {
      try {
        for await (const message of q) {
          const m = message as unknown as ClaudeMessage;
          if (m.session_id) sessionId = m.session_id;
          planFile = writtenPlanFile(m) ?? planFile;
          for (const e of mapper.map(m)) out.push(e);
          // How full the window is now, for the meter, without holding up
          // the conversation.
          if (m.type === "result")
            void q
              .getContextUsage({ detail: "summary" })
              .then((u) =>
                out.push({ type: "context", context: toChatContext(u) })
              )
              .catch(() => {});
        }
      } catch (error) {
        out.fail(error);
      } finally {
        approvals.expireAll();
        out.end();
      }
    })();

    return {
      send(text, images) {
        mapper.sent(text);
        const content = [
          ...(images ?? []).map((img) => ({
            type: "image" as const,
            source: {
              type: "base64" as const,
              media_type: img.mediaType as "image/png",
              data: img.data,
            },
          })),
          { type: "text" as const, text },
        ];
        const checkpoint = randomUUID();
        input.push({
          type: "user",
          uuid: checkpoint,
          message: { role: "user", content },
          parent_tool_use_id: null,
        } as SDKUserMessage);
        return checkpoint;
      },
      // Claude Code's own /mcp is a terminal screen; in chat it's the same
      // list, from the SDK, without spending a turn.
      runLocal(text) {
        if (text.trim() !== "/mcp") return null;
        return q.mcpServerStatus().then((servers) => [
          {
            id: randomUUID(),
            kind: "mcp" as const,
            servers: servers.map(mcpView),
            createdAt: Date.now(),
          },
        ]);
      },
      async interrupt() {
        await q.interrupt();
      },
      async fileSuggestions(query) {
        return fileSuggestions(q, query);
      },
      async setModel(model) {
        await q.setModel(model);
      },
      async setAccess(next) {
        access = next;
        if (options.permissionMode || plan) return;
        await q.setPermissionMode(sdkMode(access, plan));
      },
      async setPlan(next) {
        if (options.permissionMode) return;
        plan = next;
        await q.setPermissionMode(sdkMode(access, plan));
      },
      respond(id, answer) {
        approvals.respond(id, answer);
      },
      async stopTask(taskId) {
        await q.stopTask(taskId);
      },
      async undo(checkpoint, dryRun) {
        const r = await q.rewindFiles(checkpoint, { dryRun });
        return {
          canUndo: r.canRewind,
          error: r.error,
          files: r.filesChanged ?? [],
          insertions: r.insertions,
          deletions: r.deletions,
          resumeAt: sessionId
            ? await entryBefore(sessionId, options.cwd, checkpoint)
            : undefined,
        };
      },
      close() {
        approvals.expireAll();
        input.end();
        q.close();
      },
      events: out,
    };
  },
};

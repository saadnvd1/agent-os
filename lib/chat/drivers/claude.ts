import { randomUUID } from "crypto";
import {
  getSessionMessages,
  query,
  type SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import type { ChatDriver, ChatConversation } from "../driver";
import type { DriverEvent } from "../events";
import { InputQueue } from "../queue";
import { Approvals, SDK_MODE } from "./claude-approvals";
import { ClaudeMapper, toCommand, type ClaudeMessage } from "./claude-mapper";

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
    const approvals = new Approvals((e) => out.push(e));
    const q = query({
      prompt: input,
      options: {
        cwd: options.cwd,
        model: options.model,
        resume: options.resumeId ?? undefined,
        resumeSessionAt: options.resumeAt ?? undefined,
        permissionMode: SDK_MODE[options.access],
        allowDangerouslySkipPermissions: true,
        canUseTool: approvals.canUseTool,
        mcpServers: options.mcpServers,
        allowedTools: options.allowedTools,
        hooks: {
          PreToolUse: [
            {
              matcher: "AskUserQuestion",
              hooks: [approvals.askQuestions],
              // The reader may take a while to answer.
              timeout: 24 * 60 * 60,
            },
          ],
        },
        enableFileCheckpointing: true,
        includePartialMessages: true,
        // Each background task has its own Stop, so Stop on the turn spares
        // them.
        perTaskStopAffordance: true,
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

    void (async () => {
      try {
        for await (const message of q) {
          const m = message as unknown as ClaudeMessage;
          if (m.session_id) sessionId = m.session_id;
          for (const e of mapper.map(m)) out.push(e);
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
      async interrupt() {
        await q.interrupt();
      },
      async setModel(model) {
        await q.setModel(model);
      },
      async setAccess(access) {
        await q.setPermissionMode(SDK_MODE[access]);
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

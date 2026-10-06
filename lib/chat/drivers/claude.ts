import { query, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import type { ChatDriver, ChatConversation } from "../driver";
import type { DriverEvent } from "../events";
import { InputQueue } from "../queue";
import { ClaudeMapper, toCommand, type ClaudeMessage } from "./claude-mapper";

// Claude Code through the Agent SDK, signed in with the user's own Claude
// Code login. Full access: the same as running it with permissions skipped.
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
    const q = query({
      prompt: input,
      options: {
        cwd: options.cwd,
        model: options.model,
        resume: options.resumeId ?? undefined,
        permissionMode: "bypassPermissions",
        allowDangerouslySkipPermissions: true,
        includePartialMessages: true,
        systemPrompt: {
          type: "preset",
          preset: "claude_code",
          append: options.systemAppend,
        },
        env: { ...process.env, ...options.env },
      },
    });
    const mapper = new ClaudeMapper();

    async function* events(): AsyncGenerator<DriverEvent> {
      for await (const message of q) {
        yield* mapper.map(message as unknown as ClaudeMessage);
      }
    }

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
        input.push({
          type: "user",
          message: { role: "user", content },
          parent_tool_use_id: null,
        } as SDKUserMessage);
      },
      async interrupt() {
        await q.interrupt();
      },
      async setModel(model) {
        await q.setModel(model);
      },
      close() {
        input.end();
        q.close();
      },
      events: events(),
    };
  },
};

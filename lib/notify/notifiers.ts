// Where a phone notification goes: a shell command that takes the message on
// stdin (AGENTOS_NOTIFY_CMD), or a Telegram bot set in Settings. Neither
// ever puts the bot token in an error, a log or a command line.

import { spawn } from "child_process";

export interface Notifier {
  kind: "command" | "telegram";
  send: (text: string) => Promise<void>;
}

// Telegram's own limit is 4096.
export const MAX_TEXT = 4000;
const clip = (text: string) =>
  text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT - 1)}…` : text;

export function commandNotifier(command: string, timeoutMs = 30_000): Notifier {
  return {
    kind: "command",
    send: (text) =>
      new Promise((resolve, reject) => {
        const child = spawn("sh", ["-c", command], {
          stdio: ["pipe", "ignore", "pipe"],
        });
        let stderr = "";
        child.stderr.on("data", (d) => {
          stderr = (stderr + d.toString()).slice(-500);
        });
        const timer = setTimeout(() => {
          child.kill("SIGKILL");
          reject(
            new Error(`the notify command took over ${timeoutMs / 1000}s`)
          );
        }, timeoutMs);
        child.on("error", (e) => {
          clearTimeout(timer);
          reject(new Error(`the notify command couldn't start: ${e.message}`));
        });
        child.on("close", (code) => {
          clearTimeout(timer);
          if (code === 0) resolve();
          else
            reject(
              new Error(
                `the notify command exited ${code}${stderr.trim() ? `: ${stderr.trim().split("\n").pop()}` : ""}`
              )
            );
        });
        // A command that never reads stdin closes it early; that's its call.
        child.stdin.on("error", () => {});
        child.stdin.end(clip(text));
      }),
  };
}

export function telegramNotifier(
  token: string,
  chatId: string,
  fetchImpl: typeof fetch = fetch
): Notifier {
  const scrub = (s: string) => s.split(token).join("<token>");
  return {
    kind: "telegram",
    send: async (text) => {
      let res: Response;
      try {
        res = await fetchImpl(
          `https://api.telegram.org/bot${token}/sendMessage`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ chat_id: chatId, text: clip(text) }),
            signal: AbortSignal.timeout(20_000),
          }
        );
      } catch (e) {
        const why = e instanceof Error ? e.message : String(e);
        throw new Error(`couldn't reach Telegram: ${scrub(why)}`);
      }
      if (res.ok) return;
      const body = (await res.json().catch(() => ({}))) as {
        description?: string;
      };
      throw new Error(
        `Telegram refused it (${res.status}${body.description ? `: ${scrub(body.description)}` : ""})`
      );
    },
  };
}

export interface TelegramConfig {
  token: string | null;
  chatId: string | null;
}

// The command wins: it's set on purpose on the machine, and Saad's routes
// through the devbox's own sender, which keeps a log of every message.
export function selectNotifier(
  env: Record<string, string | undefined>,
  telegram: TelegramConfig | null
): Notifier | null {
  const command = env.AGENTOS_NOTIFY_CMD?.trim();
  if (command) return commandNotifier(command);
  if (telegram?.token && telegram.chatId)
    return telegramNotifier(telegram.token, telegram.chatId);
  return null;
}

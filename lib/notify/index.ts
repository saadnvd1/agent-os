/**
 * Phone notifications for the few things worth a buzz: a schedule run that
 * failed, and what an agent sends on purpose with `aos notify` (a morning
 * report, a real milestone). Status changes are not among them; the in-app
 * Needs-you list has those.
 */

import { db } from "../db";
import { Limiter, type Outcome } from "./limiter";
import { selectNotifier, type TelegramConfig } from "./notifiers";

export type { Outcome } from "./limiter";

export interface NotifySettingsView {
  // Which one sends now, if any.
  active: "command" | "telegram" | null;
  commandSet: boolean;
  telegram: { tokenSet: boolean; chatId: string | null };
}

function telegramConfig(): TelegramConfig | null {
  const row = db
    .prepare(
      `SELECT telegram_token AS token, telegram_chat_id AS chatId FROM notify_settings WHERE id = 1`
    )
    .get() as TelegramConfig | undefined;
  return row ?? null;
}

// Never includes the token itself.
export function notifySettings(
  env: Record<string, string | undefined> = process.env
): NotifySettingsView {
  const telegram = telegramConfig();
  return {
    active: selectNotifier(env, telegram)?.kind ?? null,
    commandSet: !!env.AGENTOS_NOTIFY_CMD?.trim(),
    telegram: { tokenSet: !!telegram?.token, chatId: telegram?.chatId ?? null },
  };
}

// A token left out keeps the stored one; null clears it.
export function setTelegram(input: {
  token?: string | null;
  chatId?: string | null;
}): void {
  const current = telegramConfig();
  const token =
    input.token === undefined
      ? (current?.token ?? null)
      : input.token?.trim() || null;
  const chatId =
    input.chatId === undefined
      ? (current?.chatId ?? null)
      : input.chatId?.trim() || null;
  if (token && /\s/.test(token))
    throw new Error("That bot token has spaces in it");
  if (chatId && !/^-?\d+$|^@\w+$/.test(chatId))
    throw new Error("A chat id is a number (or @channel)");
  db.prepare(
    `INSERT INTO notify_settings (id, telegram_token, telegram_chat_id, updated_at)
     VALUES (1, ?, ?, datetime('now'))
     ON CONFLICT(id) DO UPDATE SET telegram_token = excluded.telegram_token,
       telegram_chat_id = excluded.telegram_chat_id, updated_at = excluded.updated_at`
  ).run(token, chatId);
}

const g = globalThis as unknown as { __agentosPhone?: Limiter };

// One limiter per process, whichever copy of this module asks.
function limiter(): Limiter {
  g.__agentosPhone ??= new Limiter(
    async (text) => {
      const notifier = selectNotifier(process.env, telegramConfig());
      if (!notifier) throw new Error("no phone notifier is set up");
      await notifier.send(text);
    },
    {
      onLate: (source, error) =>
        console.error(
          `[notify] held message from ${source} didn't send:`,
          error instanceof Error ? error.message : error
        ),
    }
  );
  return g.__agentosPhone;
}

export class NotConfigured extends Error {
  constructor() {
    super(
      "No phone notifier is set up: set AGENTOS_NOTIFY_CMD, or a Telegram bot in Settings"
    );
  }
}

// Sends now, or within the minute as part of one message. Throws
// NotConfigured when nothing would send it.
export async function sendPhone(
  source: string,
  text: string
): Promise<Outcome> {
  const body = text.trim();
  if (!body) throw new Error("Nothing to send");
  if (!selectNotifier(process.env, telegramConfig())) throw new NotConfigured();
  const outcome = await limiter().push(source, body);
  if (outcome.state === "failed")
    console.error(`[notify] ${source} didn't send: ${outcome.why}`);
  return outcome;
}

// For the server's own alerts: never throws, never waits on the send.
export function notifyPhone(source: string, text: string): void {
  sendPhone(source, text).catch((error) => {
    if (!(error instanceof NotConfigured))
      console.error(
        `[notify] ${source}:`,
        error instanceof Error ? error.message : error
      );
  });
}

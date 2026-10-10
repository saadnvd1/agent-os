"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  useNotifySettings,
  useSaveTelegram,
  useTestNotify,
} from "@/data/notify";

// Where failed schedule runs and `aos notify` messages go. The bot token is
// write-only: the page only ever learns whether one is set.
export function PhoneNotifyForm() {
  const { data: settings, isPending } = useNotifySettings();
  const save = useSaveTelegram();
  const test = useTestNotify();
  const [token, setToken] = useState("");
  const [chatId, setChatId] = useState<string | null>(null);
  if (isPending || !settings)
    return <div className="bg-muted/40 h-32 animate-pulse rounded-xl" />;
  const chat = chatId ?? settings.telegram.chatId ?? "";

  return (
    <div className="space-y-5">
      <p className="text-muted-foreground text-sm">
        Your phone gets a failed schedule run, and anything an agent sends with{" "}
        <code className="font-mono text-xs">aos notify</code>. At most one a
        minute from each; the rest wait and go together.
      </p>

      <div className="bg-foreground/[0.03] rounded-lg px-3 py-2.5 text-sm">
        {settings.active === "command" ? (
          <>
            Sending through{" "}
            <code className="font-mono text-xs">AGENTOS_NOTIFY_CMD</code>, set
            on this machine. It takes priority over Telegram below.
          </>
        ) : settings.active === "telegram" ? (
          <>Sending through the Telegram bot below.</>
        ) : (
          <>
            Not set up. Add a Telegram bot below, or set{" "}
            <code className="font-mono text-xs">AGENTOS_NOTIFY_CMD</code> to a
            command that reads the message on stdin.
          </>
        )}
      </div>

      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate(
            {
              ...(token.trim() && { telegramToken: token.trim() }),
              telegramChatId: chat,
            },
            { onSuccess: () => setToken("") }
          );
        }}
      >
        <p className="label-mono text-muted-foreground">Telegram</p>
        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor="tg-token">
            Bot token
          </label>
          <Input
            id="tg-token"
            type="password"
            autoComplete="off"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder={
              settings.telegram.tokenSet ? "Saved; type to replace" : "123:ABC…"
            }
            className="h-11 font-mono md:h-9"
          />
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor="tg-chat">
            Chat id
          </label>
          <Input
            id="tg-chat"
            inputMode="numeric"
            value={chat}
            onChange={(e) => setChatId(e.target.value)}
            placeholder="Your chat id with the bot"
            className="h-11 font-mono md:h-9"
          />
        </div>
        {save.error && (
          <p className="text-destructive text-sm">{save.error.message}</p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button
            type="submit"
            className="h-11 md:h-9"
            disabled={save.isPending}
          >
            {save.isPending ? "Saving..." : "Save"}
          </Button>
          {settings.telegram.tokenSet && (
            <Button
              type="button"
              variant="ghost"
              className="text-muted-foreground h-11 md:h-9"
              disabled={save.isPending}
              onClick={() =>
                save.mutate(
                  { telegramToken: null, telegramChatId: null },
                  { onSuccess: () => setChatId(null) }
                )
              }
            >
              Remove bot
            </Button>
          )}
          <Button
            type="button"
            variant="outline"
            className="h-11 md:h-9"
            disabled={!settings.active || test.isPending}
            onClick={() => test.mutate()}
          >
            {test.isPending ? "Sending..." : "Send a test"}
          </Button>
        </div>
        {test.error && (
          <p className="text-destructive text-sm">{test.error.message}</p>
        )}
        {test.data && (
          <p className="text-muted-foreground text-sm">
            {test.data.state === "sent"
              ? "Sent."
              : test.data.state === "held"
                ? "Held: one went out under a minute ago; this follows it."
                : test.data.state === "duplicate"
                  ? "Already sent in the last minute."
                  : null}
          </p>
        )}
      </form>
    </div>
  );
}

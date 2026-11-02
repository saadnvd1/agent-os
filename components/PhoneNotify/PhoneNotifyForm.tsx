"use client";

import { Button } from "@/components/ui/button";
import { SettingSection } from "@/components/Settings/SettingRow";
import { TextSetting } from "@/components/Settings/settings-fields";
import {
  useNotifySettings,
  useSaveTelegram,
  useTestNotify,
  type TestNotifyResult,
} from "@/data/notify";

// Where failed schedule runs and `aos notify` messages go. The bot token is
// write-only: the page only ever learns whether one is set.
export function PhoneNotifyForm() {
  const { data: settings, isPending } = useNotifySettings();
  const save = useSaveTelegram();
  const test = useTestNotify();
  if (isPending || !settings)
    return <div className="bg-muted/40 h-32 animate-pulse rounded-xl" />;

  return (
    <div className="space-y-5">
      <p className="text-muted-foreground text-sm">
        Your phone gets a failed schedule run and anything an agent sends you.
        At most one a minute from each; the rest wait and go together.
      </p>

      <div className="bg-foreground/[0.03] rounded-lg px-3 py-2.5 text-sm">
        {settings.active === "command" ? (
          <>
            Sending through a command set up on this machine. It takes priority
            over Telegram below.
          </>
        ) : settings.active === "telegram" ? (
          <>Sending through the Telegram bot below.</>
        ) : (
          <>Not set up. Add a Telegram bot below.</>
        )}
      </div>

      <div className="space-y-2">
        <SettingSection title="Telegram">
          <TextSetting
            id="tg-chat"
            label="Chat id"
            help="Where the bot sends alerts: your chat id with it, or @channel."
            placeholder="123456789"
            value={settings.telegram.chatId ?? ""}
            validate={(t) =>
              !t || /^-?\d+$|^@\w+$/.test(t)
                ? null
                : "A chat id is a whole number like 123456789, or @channel."
            }
            onSave={(t) => save.mutateAsync({ telegramChatId: t || null })}
          />
          <TextSetting
            id="tg-token"
            label="Bot token"
            help="Write-only. Saved with the button, never on blur: a half-typed secret must not save."
            secret
            buttonLabel={settings.telegram.tokenSet ? "Replace" : "Connect"}
            placeholder={
              settings.telegram.tokenSet
                ? "Connected; paste to replace"
                : "123:ABC…"
            }
            value=""
            validate={(t) =>
              !t
                ? "Paste the bot token from BotFather."
                : /\s/.test(t)
                  ? "A token has no spaces."
                  : null
            }
            onSave={(t) => save.mutateAsync({ telegramToken: t })}
          />
        </SettingSection>
        <div className="flex flex-wrap gap-2">
          {settings.telegram.tokenSet && (
            <Button
              type="button"
              variant="ghost"
              className="text-muted-foreground h-11 md:h-9"
              disabled={save.isPending}
              onClick={() =>
                save.mutate({ telegramToken: null, telegramChatId: null })
              }
            >
              Remove bot
            </Button>
          )}
          <Button
            type="button"
            variant="outline"
            className="h-11 md:h-9"
            disabled={test.isPending}
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
            {testSummary(test.data)}
          </p>
        )}
      </div>
    </div>
  );
}

function testSummary({ push, telegram }: TestNotifyResult): string {
  const phones =
    push.state === "queued"
      ? `Pushed to ${push.devices} ${push.devices === 1 ? "phone" : "phones"}.`
      : push.state === "failed"
        ? `Push failed: ${push.why}.`
        : "Phone push not set up.";
  const tg =
    telegram.state === "not-set-up"
      ? "Telegram not set up."
      : telegram.state === "failed"
        ? `Telegram failed: ${telegram.why}.`
        : telegram.state === "held"
          ? "Telegram held: one went out under a minute ago; this follows it."
          : telegram.state === "duplicate"
            ? "Telegram already sent in the last minute."
            : "Sent to Telegram.";
  return `${phones} ${tg}`;
}

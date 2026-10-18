"use client";

import { useState } from "react";
import { ExternalLink } from "lucide-react";
import type { useMcpSignIn } from "@/data/chat/mcpAuth";

const LINK =
  "bg-primary text-primary-foreground inline-flex h-11 items-center justify-center gap-2 rounded-lg px-4 text-sm font-medium md:h-9";
const GHOST =
  "text-muted-foreground hover:text-foreground h-11 rounded-lg px-3 text-xs md:h-9";

// What happens after Sign in is pressed on one server: the link to open, and
// what to do if the provider can't return to AgentOS by itself. The list row
// turns connected on its own, over the chat socket, when it's done.
export function McpSignIn({
  flow: { start, finish, recheck },
  server,
  onClose,
}: {
  // Started by the Sign in press (not on mount: a dev double-mount would
  // drop the request's result).
  flow: ReturnType<typeof useMcpSignIn>;
  server: string;
  onClose: () => void;
}) {
  const [pasted, setPasted] = useState("");

  const mode = start.data?.mode;
  const authUrl = start.data?.authUrl;
  const error = start.error ?? finish.error ?? recheck.error;
  const busy = start.isPending || finish.isPending || recheck.isPending;

  return (
    <div className="space-y-2 pt-1 pr-2 pb-2 pl-6.5 text-xs">
      {start.isPending && (
        <p className="text-muted-foreground">Starting sign-in…</p>
      )}
      {mode === "done" && (
        <p className="text-muted-foreground">
          Already signed in; reconnecting.
        </p>
      )}
      {(mode === "callback" || mode === "paste" || mode === "external") &&
        authUrl && (
          <div className="flex flex-wrap items-center gap-2">
            <a
              href={authUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={LINK}
            >
              {mode === "external" ? "Open claude.ai" : "Open sign-in page"}
              <ExternalLink className="size-4" />
            </a>
            {mode === "external" && (
              <button
                type="button"
                disabled={busy}
                onClick={() => recheck.mutate()}
                className={GHOST}
              >
                Check again
              </button>
            )}
          </div>
        )}
      {mode === "callback" && (
        <p className="text-muted-foreground">
          Approve it there. This list updates by itself.
        </p>
      )}
      {mode === "external" && (
        <p className="text-muted-foreground">
          This server signs in on claude.ai. Finish there, then come back.
        </p>
      )}
      {mode === "paste" && (
        <>
          <p className="text-muted-foreground">
            This server only sends the sign-in back to the machine running the
            session. On this device the page you land on won&apos;t load: copy
            its address and paste it here.
          </p>
          <form
            className="flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (pasted.trim()) finish.mutate(pasted.trim());
            }}
          >
            <input
              value={pasted}
              onChange={(e) => setPasted(e.target.value)}
              inputMode="url"
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              placeholder="Address of the page after approving"
              aria-label={`Address after signing in to ${server}`}
              className="bg-background hairline h-11 min-w-0 flex-1 rounded-lg px-3 text-base md:h-9 md:text-xs"
            />
            <button
              type="submit"
              disabled={busy || !pasted.trim()}
              className="bg-secondary text-secondary-foreground hairline h-11 shrink-0 rounded-lg px-3 text-xs font-medium disabled:opacity-50 md:h-9"
            >
              Finish
            </button>
          </form>
        </>
      )}
      {error && (
        <p className="text-destructive whitespace-pre-wrap" role="alert">
          {error.message}
        </p>
      )}
      <button type="button" onClick={onClose} className={GHOST}>
        {error ? "Close" : "Cancel"}
      </button>
    </div>
  );
}

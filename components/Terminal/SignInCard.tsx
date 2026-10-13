"use client";

import { useState } from "react";
import { ExternalLink, X } from "lucide-react";
import { useSignIn } from "@/data/statuses/useSignIn";
import { trustedSignInUrl } from "@/lib/agents/signin-screen";
import { CopyButton } from "@/components/Chat/CopyButton";

// Finishing an agent's sign-in from this device: the link to open and the
// code to type there. The text is the CLI's own, so a link is only opened
// when it points at a sign-in page; anything else stays text to copy.
export function SignInCard({
  sessionId,
  agent,
}: {
  sessionId: string;
  agent: string;
}) {
  const signIn = useSignIn(sessionId);
  // Hidden until the sign-in shows something new.
  const [hidden, setHidden] = useState("");
  if (!signIn) return null;
  const { url, code } = signIn;
  const key = `${url}|${code}`;
  if (hidden === key) return null;
  return (
    <div
      role="status"
      className="bg-card hairline absolute inset-x-2 top-2 z-10 flex flex-col gap-3 rounded-lg p-3 shadow-lg"
    >
      <div>
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-medium">Sign in to {agent}</p>
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => setHidden(key)}
            className="text-muted-foreground hover:text-foreground -m-2 flex h-11 w-11 items-center justify-center"
          >
            <X className="size-4" />
          </button>
        </div>
        <p className="text-muted-foreground text-xs">
          Finish signing in on any device; the session carries on by itself.
        </p>
      </div>
      {code && (
        <div className="flex items-center justify-between gap-2">
          <span className="font-mono text-2xl tracking-widest select-all">
            {code}
          </span>
          <CopyButton
            text={code}
            label="Copy code"
            className="h-11 w-11 md:h-11 md:w-11"
          />
        </div>
      )}
      {url &&
        (trustedSignInUrl(url) ? (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="bg-primary text-primary-foreground flex h-11 items-center justify-center gap-2 rounded-lg text-sm font-medium"
          >
            Open sign-in page
            <ExternalLink className="size-4" />
          </a>
        ) : (
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground min-w-0 flex-1 text-xs break-all select-all">
              {url}
            </span>
            <CopyButton
              text={url}
              label="Copy link"
              className="h-11 w-11 md:h-11 md:w-11"
            />
          </div>
        ))}
    </div>
  );
}

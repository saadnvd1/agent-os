"use client";

import { openSessionLink } from "@/components/Chat/session-link";
import { compactTimeAgo } from "@/lib/session-meta";
import { hrefWithSession } from "@/lib/session-url";
import type { EnvSessionView } from "@/lib/health/env/types";

export function SessionList({
  sessions,
  pending,
  error,
}: {
  sessions: EnvSessionView[];
  pending: boolean;
  error?: string;
}) {
  if (pending)
    return <div className="bg-muted/40 h-16 animate-pulse rounded-lg" />;
  if (error)
    return (
      <p role="alert" className="text-destructive text-sm">
        {error}
      </p>
    );
  return (
    <ul className="space-y-1">
      {sessions.map((s) => (
        <li key={s.sessionId} className="min-h-11 text-sm">
          <a
            href={hrefWithSession("/", s.sessionId)}
            onClick={(e) => openSessionLink(e, s.sessionId)}
            className="font-medium underline-offset-2 hover:underline"
          >
            {s.name}
          </a>
          <span className="text-muted-foreground">
            {s.project ? ` · ${s.project}` : ""} ·{" "}
            {compactTimeAgo(new Date(s.lastAt))} · fix {s.fix}
          </span>
          {s.command && (
            <code className="text-muted-foreground block truncate text-xs">
              {s.command}
            </code>
          )}
        </li>
      ))}
    </ul>
  );
}

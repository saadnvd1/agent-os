"use client";

import { useState } from "react";
import { ChevronRight } from "lucide-react";
import type { ChatItem, McpServerView } from "@/lib/chat/events";
import { cn } from "@/lib/utils";

type Status = McpServerView["status"];

const STATUS: Record<Status, { label: string; dot: string }> = {
  connected: { label: "connected", dot: "bg-emerald-500" },
  pending: { label: "connecting", dot: "bg-amber-500" },
  "needs-auth": { label: "needs sign-in", dot: "bg-amber-500" },
  failed: { label: "failed", dot: "bg-destructive" },
  disabled: { label: "disabled", dot: "bg-muted-foreground/40" },
};

function summary(servers: McpServerView[]): string {
  const counts = new Map<Status, number>();
  for (const s of servers)
    counts.set(s.status, (counts.get(s.status) ?? 0) + 1);
  const parts = (Object.keys(STATUS) as Status[])
    .filter((k) => counts.get(k))
    .map((k) => `${counts.get(k)} ${STATUS[k].label}`);
  return parts.join(" · ");
}

function Server({ server }: { server: McpServerView }) {
  const [open, setOpen] = useState(false);
  const status = STATUS[server.status];
  const tools = server.tools.length;
  return (
    <li>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        disabled={!tools && !server.error}
        aria-expanded={open}
        className="hover:bg-foreground/[0.04] flex min-h-11 w-full items-center gap-2.5 rounded-lg px-2 text-left disabled:hover:bg-transparent md:min-h-9"
      >
        <span className={cn("h-2 w-2 shrink-0 rounded-full", status.dot)} />
        <span className="min-w-0 flex-1 truncate font-mono text-xs">
          {server.name}
        </span>
        <span className="text-muted-foreground shrink-0 text-xs">
          {status.label}
          {tools ? ` · ${tools} tool${tools === 1 ? "" : "s"}` : ""}
        </span>
        <ChevronRight
          className={cn(
            "text-muted-foreground h-3.5 w-3.5 shrink-0 transition-transform",
            open && "rotate-90",
            !tools && !server.error && "invisible"
          )}
        />
      </button>
      {open && (
        <div className="text-muted-foreground space-y-1 pt-1 pr-2 pb-2 pl-6.5 text-xs">
          {server.scope && <p>From {server.scope} config</p>}
          {server.error && (
            <p className="text-destructive whitespace-pre-wrap">
              {server.error}
            </p>
          )}
          {server.tools.map((t) => (
            <p key={t.name} className="truncate">
              <span className="text-foreground/80 font-mono">{t.name}</span>
              {t.description && ` · ${t.description}`}
            </p>
          ))}
        </div>
      )}
    </li>
  );
}

// What /mcp shows in a terminal, as a chat item: each server, whether it's
// connected, and its tools.
export function McpServers({
  item,
}: {
  item: Extract<ChatItem, { kind: "mcp" }>;
}) {
  return (
    <div className="bg-foreground/[0.03] rounded-xl px-1.5 py-2">
      <p className="px-2 pb-1">
        <span className="label-mono text-muted-foreground">MCP servers</span>
        {item.servers.length > 0 && (
          <span className="text-muted-foreground ml-2 text-xs">
            {summary(item.servers)}
          </span>
        )}
      </p>
      {item.servers.length === 0 ? (
        <p className="text-muted-foreground px-2 py-1 text-sm">
          No MCP servers are set up for this session.
        </p>
      ) : (
        <ul>
          {item.servers.map((s) => (
            <Server key={s.name} server={s} />
          ))}
        </ul>
      )}
    </div>
  );
}

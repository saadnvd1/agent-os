"use client";

import { useMemo, useState } from "react";
import { useSnapshot } from "valtio";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useBusMessages, useBusPeers, useSendMessage } from "@/data/bus";
import { compactTimeAgo, fromSqliteTime } from "@/lib/session-meta";
import { busUi, busUiActions } from "@/stores/busUi";
import { cn } from "@/lib/utils";

const ALL = "all";

export function MessagesDialog() {
  const { open } = useSnapshot(busUi);
  const { data: messages = [], isPending } = useBusMessages(open);
  const { data: peers = [] } = useBusPeers(open);
  const send = useSendMessage();
  const [filter, setFilter] = useState(ALL);
  const [to, setTo] = useState("");
  const [body, setBody] = useState("");

  const label = (p: { name: string; projectName: string | null }) =>
    p.projectName ? `${p.projectName} / ${p.name}` : p.name;
  const shown = useMemo(
    () =>
      filter === ALL
        ? messages
        : messages.filter((m) => m.fromId === filter || m.toId === filter),
    [messages, filter]
  );
  const recipient = to || (filter !== ALL ? filter : "");

  return (
    <Dialog open={open} onOpenChange={busUiActions.setOpen}>
      <DialogContent className="flex max-h-[85vh] max-w-2xl flex-col">
        <DialogHeader>
          <DialogTitle>Messages</DialogTitle>
          <DialogDescription>
            What your agent sessions are saying to each other. Agents use the{" "}
            <code className="font-mono text-xs">aos</code> command.
          </DialogDescription>
        </DialogHeader>

        <Select value={filter} onValueChange={setFilter}>
          <SelectTrigger
            aria-label="Filter by session"
            className="w-full sm:w-72"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All sessions</SelectItem>
            {peers.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {label(p)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="min-h-40 flex-1 space-y-3 overflow-y-auto pr-1">
          {isPending && (
            <div className="bg-muted/40 h-16 animate-pulse rounded-xl" />
          )}
          {!isPending && shown.length === 0 && (
            <p className="text-muted-foreground py-8 text-center text-sm">
              No messages yet.
            </p>
          )}
          {shown.map((m) => (
            <div key={m.id} className="space-y-1">
              <div className="flex items-baseline gap-2 text-xs">
                <span
                  className={cn("font-medium", !m.fromId && "text-primary")}
                >
                  {m.fromName}
                </span>
                <span className="text-muted-foreground/60">→</span>
                <span className="font-medium">{m.toName}</span>
                <span className="text-muted-foreground/60 ml-auto font-mono tabular-nums">
                  {compactTimeAgo(fromSqliteTime(m.createdAt))}
                </span>
              </div>
              <p className="bg-foreground/[0.04] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap">
                {m.body}
              </p>
            </div>
          ))}
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            send.mutate(
              { to: recipient, body },
              { onSuccess: () => setBody("") }
            );
          }}
          className="space-y-2"
        >
          <Select value={recipient} onValueChange={setTo}>
            <SelectTrigger aria-label="Send to">
              <SelectValue placeholder="Send to a session..." />
            </SelectTrigger>
            <SelectContent>
              {peers.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {label(p)}
                  {!p.running && " (not running)"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="flex gap-2">
            <Textarea
              aria-label="Message"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Message as you"
              rows={2}
              className="min-h-11"
            />
            <Button
              type="submit"
              disabled={!recipient || !body.trim() || send.isPending}
            >
              Send
            </Button>
          </div>
          {send.error && (
            <p className="text-destructive text-xs">{send.error.message}</p>
          )}
        </form>
      </DialogContent>
    </Dialog>
  );
}

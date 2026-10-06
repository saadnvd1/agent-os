"use client";

import { useEffect, useRef } from "react";
import { useChat } from "@/data/chat/useChat";
import { groupTimeline } from "@/lib/chat/group";
import type { ChatItem } from "@/lib/chat/events";
import { Composer } from "./Composer";
import { ToolGroup } from "./Tools";
import {
  AssistantMessage,
  ErrorMessage,
  Reasoning,
  Todos,
  TurnEnd,
  UserMessage,
} from "./Messages";

function Item({ item }: { item: ChatItem }) {
  switch (item.kind) {
    case "user":
      return <UserMessage item={item} />;
    case "assistant":
      return <AssistantMessage item={item} />;
    case "reasoning":
      return <Reasoning item={item} />;
    case "todos":
      return <Todos item={item} />;
    case "turn_end":
      return <TurnEnd item={item} />;
    case "error":
      return <ErrorMessage item={item} />;
    default:
      return null;
  }
}

export function ChatPanel({
  sessionId,
  sessionName,
}: {
  sessionId: string;
  sessionName: string;
}) {
  const { items, state, connected, send, interrupt } = useChat(sessionId);
  const scrollRef = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);

  // Follow new output while the reader is at the bottom; leave them be if
  // they've scrolled up to read.
  useEffect(() => {
    const el = scrollRef.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [items]);

  const running = state === "running";
  const blocks = groupTimeline(items);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        ref={scrollRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          pinned.current =
            el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
        className="min-h-0 flex-1 overflow-y-auto"
      >
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-5">
          {blocks.length === 0 && (
            <p className="text-muted-foreground py-16 text-center text-sm">
              Ask anything to start.
            </p>
          )}
          {blocks.map((b) =>
            b.type === "tools" ? (
              <ToolGroup key={b.id} tools={b.tools} />
            ) : (
              <Item key={b.item.id} item={b.item} />
            )
          )}
          {running && blocks.at(-1)?.type !== "tools" && (
            <p className="text-muted-foreground animate-pulse text-xs">
              Working…
            </p>
          )}
        </div>
      </div>
      <div className="mx-auto w-full max-w-3xl px-3 pb-3">
        <Composer
          running={running}
          disabled={!connected}
          placeholder={connected ? `Message ${sessionName}` : "Reconnecting…"}
          onSend={(text, images) => {
            pinned.current = true;
            send(text, images.length ? images : undefined);
          }}
          onStop={interrupt}
        />
      </div>
    </div>
  );
}

"use client";

import { useEffect, useRef } from "react";
import { useSnapshot } from "valtio";
import { Layers, ListChecks, Minimize2, Square } from "lucide-react";
import type { ChatContext } from "@/lib/chat/events";
import { usePaletteCommands } from "@/hooks/usePaletteCommands";
import { chatMeta, chatMetaActions, type ChatActions } from "@/stores/chatMeta";

// Shares an open chat with the pane bars (its context meter) and, while it's
// the focused chat, offers its commands in the palette.
export function useChatCommands({
  sessionId,
  connected,
  running,
  context,
  plan,
  background,
  ...handlers
}: ChatActions & {
  sessionId: string;
  connected: boolean;
  running: boolean;
  context: ChatContext | null;
  plan: boolean | null;
  // Set while a running call can move to the background.
  background?: () => void;
}) {
  const latest = useRef({ ...handlers, background });
  useEffect(() => {
    latest.current = { ...handlers, background };
  });

  useEffect(() => {
    const actions: ChatActions = {
      send: (t) => latest.current.send(t),
      setPlan: (p) => latest.current.setPlan(p),
      interrupt: () => latest.current.interrupt(),
      focusComposer: () => latest.current.focusComposer(),
    };
    chatMetaActions.setActions(sessionId, actions);
    return () => chatMetaActions.remove(sessionId, actions);
  }, [sessionId]);

  useEffect(() => {
    chatMetaActions.set(sessionId, { context, plan, running });
  }, [sessionId, context, plan, running]);

  const { active } = useSnapshot(chatMeta);
  usePaletteCommands(
    "chat",
    active === sessionId && connected
      ? [
          ...(plan === null
            ? []
            : [
                {
                  id: "chat.plan",
                  title: plan ? "Leave plan mode" : "Plan mode",
                  group: "Chat",
                  keywords: ["toggle plan", "permission"],
                  hint: "⇧Tab",
                  icon: ListChecks,
                  run: () => latest.current.setPlan(!plan),
                },
              ]),
          {
            id: "chat.compact",
            title: "Compact the conversation",
            group: "Chat",
            keywords: ["/compact", "context", "summarise"],
            icon: Minimize2,
            run: () => latest.current.send("/compact"),
          },
          ...(background
            ? [
                {
                  id: "chat.background",
                  title: "Run in background",
                  group: "Chat",
                  keywords: ["move", "detach", "task"],
                  hint: "Ctrl+B",
                  icon: Layers,
                  run: () => latest.current.background?.(),
                },
              ]
            : []),
          ...(running
            ? [
                {
                  id: "chat.stop",
                  title: "Stop the current turn",
                  group: "Chat",
                  keywords: ["interrupt", "cancel", "esc"],
                  hint: "Esc",
                  icon: Square,
                  run: () => latest.current.interrupt(),
                },
              ]
            : []),
        ]
      : null
  );
}

"use client";

import { useEffect } from "react";
import { subscribe } from "valtio";
import { toast } from "sonner";
import {
  orchestratorOpenActions,
  orchestratorOpenStore,
} from "@/stores/orchestratorOpen";

// Opens a workspace's orchestrator chat, making it on first open.
export function useOpenOrchestrator(onOpened: (sessionId: string) => void) {
  useEffect(
    () =>
      subscribe(orchestratorOpenStore, async () => {
        const request = orchestratorOpenStore.request;
        if (!request) return;
        orchestratorOpenActions.clear();
        try {
          const res = await fetch(
            `/api/workspaces/${request.workspaceId}/orchestrator`,
            { method: "POST" }
          );
          const data = (await res.json()) as {
            session?: { id: string };
            error?: string;
          };
          if (!data.session) throw new Error(data.error ?? "Couldn't open");
          onOpened(data.session.id);
        } catch (error) {
          toast.error(
            error instanceof Error
              ? error.message
              : "Couldn't open the orchestrator"
          );
        }
      }),
    [onOpened]
  );
}

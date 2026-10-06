"use client";

import { useEffect } from "react";
import { subscribe } from "valtio";
import { toast } from "sonner";
import { quickStartActions, quickStartStore } from "@/stores/quickStart";
import { SKIP_PERMISSIONS_KEY } from "@/components/NewSessionDialog/NewSessionDialog.types";

function savedSkipPermissions(): boolean {
  try {
    return localStorage.getItem(SKIP_PERMISSIONS_KEY) === "true";
  } catch {
    return false;
  }
}

// Starts a session with the project's own defaults (agent, model, folder) and
// the permission choice last made in the New Session dialog, then opens it.
export function useQuickStart(onCreated: (sessionId: string) => void) {
  useEffect(
    () =>
      subscribe(quickStartStore, async () => {
        const request = quickStartStore.request;
        if (!request) return;
        quickStartActions.clear();
        try {
          const res = await fetch("/api/sessions", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              projectId: request.projectId,
              workingDirectory: request.workingDirectory,
              agentType: request.agentType,
              autoApprove: savedSkipPermissions(),
            }),
          });
          const data = (await res.json()) as {
            session?: { id: string };
            error?: string;
          };
          if (!data.session) throw new Error(data.error ?? "Couldn't start");
          onCreated(data.session.id);
        } catch (error) {
          toast.error(
            error instanceof Error ? error.message : "Couldn't start a session"
          );
        }
      }),
    [onCreated]
  );
}

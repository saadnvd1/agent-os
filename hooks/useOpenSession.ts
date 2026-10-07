"use client";

import { useEffect } from "react";
import { subscribe } from "valtio";
import { sessionOpenActions, sessionOpenStore } from "@/stores/sessionOpen";

export function useOpenSession(onOpen: (sessionId: string) => void) {
  useEffect(
    () =>
      subscribe(sessionOpenStore, () => {
        const request = sessionOpenStore.request;
        if (!request) return;
        sessionOpenActions.clear();
        onOpen(request.sessionId);
      }),
    [onOpen]
  );
}

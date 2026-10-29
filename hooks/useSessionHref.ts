"use client";

import { useContext } from "react";
import { QueryClientContext } from "@tanstack/react-query";
import { sessionKeys } from "@/data/sessions/keys";
import type { SessionsResponse } from "@/data/sessions/queries";
import { sessionPath } from "@/lib/session-url";

/**
 * A session's address from just its id: readable when the list has its name,
 * `/s/<id8>` otherwise (opening that fills the slug in). Works without a
 * query client too: a chat rendered to static markup (an export, a share).
 */
export function useSessionHref(id: string): string {
  const list = useContext(QueryClientContext)?.getQueryData<SessionsResponse>(
    sessionKeys.list()
  );
  const name = list?.sessions.find((s) => s.id === id)?.name;
  return sessionPath({ id, name });
}

"use client";

import { createContext, useContext } from "react";
import type { LeadDirectionView } from "@/lib/leads/direction-view";

// A lead chat's direction, for its messages: which ones are pinned or
// proposed, and the owner's actions on them. Absent in any other chat.
export interface DirectionChat {
  view: LeadDirectionView;
  pin: (itemId: string) => void;
  answer: (proposalId: number, pin: boolean) => void;
  busy: boolean;
}

export const DirectionChatContext = createContext<DirectionChat | null>(null);

export const useDirectionChat = () => useContext(DirectionChatContext);

// Short date for a pin: "Nov 2". SQLite datetimes are UTC.
export function pinDate(at: string): string {
  const d = new Date(at.includes("T") ? at : `${at.replace(" ", "T")}Z`);
  return Number.isNaN(d.getTime())
    ? at.slice(0, 10)
    : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

"use client";

import { useSnapshot } from "valtio";
import { tipsActions, tipsStore } from "@/stores/tips";
import { TipDialog } from "./TipDialog";

/** Mounted once, near the top of the app: the footer icon opens it. */
export function TipHost() {
  const { open } = useSnapshot(tipsStore);
  if (!open) return null;
  return (
    <TipDialog open onOpenChange={(next) => !next && tipsActions.close()} />
  );
}

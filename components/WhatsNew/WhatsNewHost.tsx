"use client";

import { useSnapshot } from "valtio";
import { whatsNewActions, whatsNewStore } from "@/stores/whatsNew";
import { WhatsNewDialog } from "./WhatsNewDialog";

/** Mounted once, near the top of the app: the footer row and the update banner both open it. */
export function WhatsNewHost() {
  const { open } = useSnapshot(whatsNewStore);
  if (!open) return null;
  return (
    <WhatsNewDialog
      open
      onOpenChange={(next) => !next && whatsNewActions.close()}
    />
  );
}

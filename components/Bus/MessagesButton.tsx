"use client";

import { MessagesSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { busUiActions } from "@/stores/busUi";

export function MessagesButton() {
  return (
    <Button size="sm" variant="ghost" onClick={busUiActions.open}>
      <MessagesSquare className="h-4 w-4" />
      Messages
    </Button>
  );
}

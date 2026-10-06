"use client";

import { MessagesSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { busUiActions } from "@/stores/busUi";

export function MessagesButton({
  labelClassName,
}: {
  labelClassName?: string;
}) {
  return (
    <Button
      size="sm"
      variant="ghost"
      aria-label="Messages"
      title="Messages"
      className="h-7 px-2"
      onClick={busUiActions.open}
    >
      <MessagesSquare className="h-4 w-4" />
      <span className={labelClassName}>Messages</span>
    </Button>
  );
}

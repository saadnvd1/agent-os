"use client";

import { Copy, Clipboard, ZoomIn, ZoomOut, CornerDownLeft } from "lucide-react";
import { Button } from "./ui/button";
import { cn } from "@/lib/utils";

interface TerminalToolbarProps {
  onSendY: () => void;
  onSendN: () => void;
  onSendEnter: () => void;
  onSendCtrlC: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onCopy: () => void;
  onPaste: () => void;
  fontSize: number;
  className?: string;
}

/**
 * Quick action toolbar for terminal on mobile
 * Provides one-tap access to common terminal actions
 */
export function TerminalToolbar({
  onSendY,
  onSendN,
  onSendEnter,
  onSendCtrlC,
  onZoomIn,
  onZoomOut,
  onCopy,
  onPaste,
  fontSize,
  className,
}: TerminalToolbarProps) {
  return (
    <div className={cn(
      "flex items-center gap-1 p-2 bg-background/95 backdrop-blur-sm border-b border-border",
      "md:hidden", // Only show on mobile
      className
    )}>
      {/* Quick response buttons */}
      <div className="flex items-center gap-1 flex-1">
        <Button
          variant="outline"
          size="sm"
          onClick={onSendY}
          className="h-8 px-3"
        >
          Y
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={onSendN}
          className="h-8 px-3"
        >
          n
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={onSendEnter}
          className="h-8 px-2"
          title="Enter"
        >
          <CornerDownLeft className="w-4 h-4" />
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={onSendCtrlC}
          className="h-8 px-3"
          title="Ctrl+C"
        >
          ^C
        </Button>
      </div>

      {/* Font size controls */}
      <div className="flex items-center gap-1 border-l border-border pl-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={onZoomOut}
          className="h-8 w-8 p-0"
          disabled={fontSize <= 10}
          title="Decrease font size"
        >
          <ZoomOut className="w-4 h-4" />
        </Button>
        <span className="text-xs text-muted-foreground min-w-[28px] text-center">
          {fontSize}px
        </span>
        <Button
          variant="ghost"
          size="sm"
          onClick={onZoomIn}
          className="h-8 w-8 p-0"
          disabled={fontSize >= 24}
          title="Increase font size"
        >
          <ZoomIn className="w-4 h-4" />
        </Button>
      </div>

      {/* Copy/Paste */}
      <div className="flex items-center gap-1 border-l border-border pl-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={onCopy}
          className="h-8 w-8 p-0"
          title="Copy selection"
        >
          <Copy className="w-4 h-4" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={onPaste}
          className="h-8 w-8 p-0"
          title="Paste"
        >
          <Clipboard className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
}

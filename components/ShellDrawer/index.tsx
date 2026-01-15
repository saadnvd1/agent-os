"use client";

import { useRef, useCallback, useEffect } from "react";
import dynamic from "next/dynamic";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useDrawerAnimation } from "@/hooks/useDrawerAnimation";
import type { TerminalHandle } from "@/components/Terminal";

const Terminal = dynamic(
  () => import("@/components/Terminal").then((mod) => mod.Terminal),
  { ssr: false }
);

interface ShellDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workingDirectory: string;
}

export function ShellDrawer({
  open,
  onOpenChange,
  workingDirectory,
}: ShellDrawerProps) {
  const terminalRef = useRef<TerminalHandle | null>(null);
  const hasInitialized = useRef(false);

  // Animation
  const isAnimatingIn = useDrawerAnimation(open);

  // When terminal connects, cd to working directory
  const handleConnected = useCallback(() => {
    if (terminalRef.current && workingDirectory && !hasInitialized.current) {
      hasInitialized.current = true;
      // Clear any existing command, cd to directory, and clear screen
      setTimeout(() => {
        terminalRef.current?.sendInput("\x15"); // Ctrl+U to clear line
        setTimeout(() => {
          terminalRef.current?.sendCommand(`cd ${workingDirectory} && clear`);
        }, 50);
      }, 100);
    }
  }, [workingDirectory]);

  // Reset initialization flag when drawer closes
  useEffect(() => {
    if (!open) {
      hasInitialized.current = false;
    }
  }, [open]);

  if (!open) return null;

  return (
    <div
      className={cn(
        "bg-muted/30 flex h-full flex-col transition-all duration-200 ease-out",
        isAnimatingIn ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0"
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1.5">
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground font-mono text-sm">
            {">_"}
          </span>
          <span className="text-muted-foreground truncate text-xs">
            {workingDirectory}
          </span>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => onOpenChange(false)}
          className="h-7 w-7"
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Terminal */}
      <div className="flex-1 overflow-hidden">
        <Terminal
          ref={terminalRef}
          onConnected={handleConnected}
          showImageButton={false}
        />
      </div>
    </div>
  );
}

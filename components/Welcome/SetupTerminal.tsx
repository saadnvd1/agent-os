"use client";

import { useCallback, useEffect, useRef } from "react";
import dynamic from "next/dynamic";
import { Button } from "@/components/ui/button";
import type { TerminalHandle } from "@/components/Terminal";

const Terminal = dynamic(
  () => import("@/components/Terminal").then((m) => m.Terminal),
  { ssr: false }
);

/**
 * A terminal on this machine with one setup command typed at the prompt, for
 * the user to read and run with Enter. It goes into their own shell over the
 * existing terminal socket; the server runs nothing.
 */
export function SetupTerminal({
  title,
  command,
  onDone,
}: {
  title: string;
  command: string;
  onDone: () => void;
}) {
  const ref = useRef<TerminalHandle | null>(null);
  const typed = useRef(false);
  const box = useRef<HTMLDivElement>(null);

  // On a phone it opens below the list, out of sight.
  useEffect(() => {
    box.current?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
  }, []);

  const connected = useCallback(() => {
    if (typed.current) return;
    typed.current = true;
    setTimeout(() => {
      ref.current?.sendInput("\x15");
      // Typed, not run: the user reads it and presses Enter.
      setTimeout(() => ref.current?.sendInput(command), 50);
    }, 100);
  }, [command]);

  return (
    <div
      ref={box}
      className="bg-muted/30 hairline flex flex-col overflow-hidden rounded-lg"
    >
      <div className="flex items-center justify-between gap-2 px-3 py-1.5">
        <span className="text-muted-foreground truncate text-xs">
          {title}. Press Enter to run it.
        </span>
        <Button size="sm" onClick={onDone}>
          Done, check again
        </Button>
      </div>
      <div className="h-64 min-h-0">
        <Terminal ref={ref} onConnected={connected} />
      </div>
    </div>
  );
}

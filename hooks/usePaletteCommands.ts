"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import type { PaletteCommand } from "@/lib/palette/registry";
import { paletteRegistry } from "@/stores/palette";

// Offers commands in the palette while the caller is mounted. Each command's
// run always calls the caller's latest handler, so the list need not be
// memoised; it's re-registered only when its ids or titles change.
export function usePaletteCommands(
  source: string,
  commands: PaletteCommand[] | null
) {
  const latest = useRef(commands);
  useEffect(() => {
    latest.current = commands;
  });
  const shape = commands
    ? commands
        .map((c) => `${c.id}\u0000${c.title}\u0000${c.hint ?? ""}`)
        .join("\u0001")
    : null;
  useEffect(() => {
    if (shape === null || !latest.current) return;
    const stable = latest.current.map((c) => ({
      ...c,
      run: () => latest.current?.find((x) => x.id === c.id)?.run(),
    }));
    return paletteRegistry.register(source, stable);
  }, [source, shape]);
}

export function usePaletteList(): PaletteCommand[] {
  return useSyncExternalStore(
    (l) => paletteRegistry.subscribe(l),
    () => paletteRegistry.list(),
    () => paletteRegistry.list()
  );
}

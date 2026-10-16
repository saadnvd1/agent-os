"use client";

import { useEffect, useRef } from "react";
import { keybindings, type Keybinding } from "@/lib/keybindings/registry";

// Binds chords while the caller is mounted. `when` and `run` always see the
// latest render, so callers don't memoise them.
export function useKeybindings(source: string, bindings: Keybinding[]) {
  const latest = useRef(bindings);
  useEffect(() => {
    latest.current = bindings;
  });
  const keys = bindings
    .map((b) => `${b.id}:${b.keys}:${b.repeat ? 1 : 0}`)
    .join("|");
  useEffect(() => {
    const at = (id: string) => latest.current.find((b) => b.id === id)!;
    return keybindings.register(
      source,
      latest.current.map((b) => ({
        ...b,
        when: (e) => at(b.id).when?.(e) ?? true,
        run: () => at(b.id).run(),
      }))
    );
  }, [source, keys]);
}

"use client";

import { useEffect, useRef } from "react";
import { useKeybindings } from "@/hooks/useKeybindings";
import { useStoredFlag } from "@/hooks/useStoredFlag";
import { isFreeTarget } from "@/lib/keybindings/focus";
import { KEYMAP, isSequence, keysOf } from "@/lib/keybindings/keymap";
import {
  SEQUENCE_MS,
  SequenceMatcher,
  plainKey,
} from "@/lib/keybindings/sequence";
import { shortcutsUiActions } from "@/stores/shortcutsUi";

export const SINGLE_KEYS_FLAG = "agentos-single-key-shortcuts";

/** The single-key shortcuts' on/off switch, kept per browser. */
export const useSingleKeys = () => useStoredFlag(SINGLE_KEYS_FLAG, true);

export type NavActions = Record<string, () => void>;

const SEQUENCES = Object.fromEntries(
  KEYMAP.filter((k) => k.single && isSequence(k.keys)).map((k) => [
    k.keys,
    k.id,
  ])
);
const BARE = Object.fromEntries(
  KEYMAP.filter((k) => k.single && !isSequence(k.keys)).map((k) => [
    k.keys,
    k.id,
  ])
);

const CHORD_IDS = ["switcher.open", "palette.open"];

const dialogOpen = () =>
  !!document.querySelector('[role="dialog"][data-state="open"]');

/**
 * The app's keys by id (see keymap.ts): chords through the registry, bare
 * keys and two-key sequences here, only while nothing is being typed into
 * and the single-key switch is on.
 */
export function useNavKeys(actions: NavActions) {
  const latest = useRef(actions);
  useEffect(() => {
    latest.current = actions;
  });
  const run = (id: string) => latest.current[id]?.();
  const [singles] = useSingleKeys();
  const singlesOn = useRef(singles);
  useEffect(() => {
    singlesOn.current = singles;
  });

  // The sidebar's ⌘↑/⌘↓ are bound by useSessionSwitching, from the same table.
  useKeybindings(
    "nav",
    CHORD_IDS.map((id) => ({ id, keys: keysOf(id), run: () => run(id) }))
  );

  useEffect(() => {
    const matcher = new SequenceMatcher(SEQUENCES);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const clear = () => {
      clearTimeout(timer);
      matcher.reset();
      shortcutsUiActions.setPending(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (!singlesOn.current) return clear();
      if (e.metaKey || e.ctrlKey || e.altKey || e.isComposing) return clear();
      if (!isFreeTarget(e.target) || dialogOpen()) return clear();
      if (e.key === "Escape") return clear();
      if (e.key === "Shift") return;
      const bare = plainKey(e.key, e.shiftKey);
      if (bare === null) return clear();
      const waiting = matcher.pending() !== null;
      const step = matcher.feed(bare);
      if (step.kind === "match") {
        e.preventDefault();
        clear();
        run(step.id);
      } else if (step.kind === "pending") {
        e.preventDefault();
        shortcutsUiActions.setPending(step.first);
        clearTimeout(timer);
        timer = setTimeout(clear, SEQUENCE_MS);
      } else {
        clear();
        const id = BARE[bare.toLowerCase()];
        if (id && !waiting && !e.repeat) {
          e.preventDefault();
          run(id);
        }
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      clear();
    };
  }, []);
}

"use client";

import { useState } from "react";
import { useSnapshot } from "valtio";
import { Search } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { useSingleKeys } from "@/hooks/useNavKeys";
import { chordHint, isMac } from "@/lib/keybindings/chord";
import {
  isSequence,
  searchKeymap,
  type KeyEntry,
  type KeyGroup,
} from "@/lib/keybindings/keymap";
import { shortcutsUi, shortcutsUiActions } from "@/stores/shortcutsUi";

const GROUPS: KeyGroup[] = ["Go to", "Chats", "General", "Browser"];

// The browser's own keys for back and forward, per platform.
function hint(k: KeyEntry): string[] {
  if (isSequence(k.keys)) return k.keys.split(" ").map((x) => x.toUpperCase());
  if (k.browser) {
    if (!isMac()) return [k.id === "history.back" ? "Alt+←" : "Alt+→"];
    const arrow = k.keys.replace("[", "left").replace("]", "right");
    return [chordHint(k.keys, true), chordHint(arrow, true)];
  }
  return [chordHint(k.keys)];
}

function Row({ k }: { k: KeyEntry }) {
  const parts = hint(k);
  return (
    <li className="flex min-h-11 items-center justify-between gap-3 py-1 md:min-h-8">
      <span className="min-w-0 text-sm">{k.label}</span>
      <span className="flex shrink-0 items-center gap-1">
        {isSequence(k.keys) ? (
          parts.map((p, i) => <Kbd key={i}>{p}</Kbd>)
        ) : (
          <Kbd>{parts.join(" · ")}</Kbd>
        )}
      </span>
    </li>
  );
}

const Kbd = ({ children }: { children: React.ReactNode }) => (
  <kbd className="bg-muted text-muted-foreground min-w-6 rounded border px-1.5 py-0.5 text-center font-mono text-xs">
    {children}
  </kbd>
);

/** Every shortcut, searchable, with the switch that turns the bare-key ones off. */
export function ShortcutsDialog() {
  const { open } = useSnapshot(shortcutsUi);
  const [query, setQuery] = useState("");
  const [singles, setSingles] = useSingleKeys();
  const found = searchKeymap(query);
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        shortcutsUiActions.setOpen(o);
        if (!o) setQuery("");
      }}
    >
      <DialogContent className="flex max-h-[min(80dvh,640px)] flex-col gap-3 sm:max-w-lg">
        <DialogTitle>Keyboard shortcuts</DialogTitle>
        <DialogDescription className="sr-only">
          Search the shortcuts and turn the single-key ones off
        </DialogDescription>
        <label className="border-foreground/10 flex items-center gap-2 rounded-md border px-3">
          <Search className="text-muted-foreground h-4 w-4 shrink-0" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search shortcuts…"
            aria-label="Search shortcuts"
            className="placeholder:text-muted-foreground h-11 min-w-0 flex-1 bg-transparent text-base outline-none sm:text-sm"
          />
        </label>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          {found.length === 0 && (
            <p className="text-muted-foreground py-6 text-center text-sm">
              No shortcut matches.
            </p>
          )}
          {GROUPS.map((g) => {
            const rows = found.filter((k) => k.group === g);
            if (!rows.length) return null;
            return (
              <section key={g} className="mb-3">
                <h3 className="label-mono text-muted-foreground mb-1">{g}</h3>
                <ul>
                  {rows.map((k) => (
                    <Row key={k.id} k={k} />
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
        <label className="border-foreground/10 flex min-h-11 items-center justify-between gap-3 border-t pt-3 text-sm">
          <span>
            Single-key shortcuts
            <span className="text-muted-foreground block text-xs">
              Letters like C and G I, only when you are not typing. This browser
              only.
            </span>
          </span>
          <Switch checked={singles} onCheckedChange={setSingles} />
        </label>
      </DialogContent>
    </Dialog>
  );
}

import { PALETTE_TABS, type PaletteTab } from "./registry";

const PREFIXES: Record<string, PaletteTab> = {
  ">": "commands",
  "@": "sessions",
};

// A leading `>` or `@` on a fresh query picks a tab; null when there's none.
export function parsePrefix(
  text: string
): { tab: PaletteTab; text: string } | null {
  const tab = PREFIXES[text[0]];
  return tab ? { tab, text: text.slice(1).trimStart() } : null;
}

// The next tab (or the one before), wrapping round.
export function cycleTab(tab: PaletteTab, by: 1 | -1): PaletteTab {
  const n = PALETTE_TABS.length;
  const i = PALETTE_TABS.findIndex((t) => t.id === tab);
  return PALETTE_TABS[(i + by + n) % n].id;
}

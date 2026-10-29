import {
  PALETTE_TABS,
  actsOnFocusedSession,
  scoreCommands,
  tabOf,
  type PaletteCommand,
  type PaletteTab,
} from "./registry";
import { recentIds, usageBoost, type Usage } from "./usage";

export interface Section {
  name: string;
  items: PaletteCommand[];
  // The tab that lists the whole section, when this is only part of it.
  more?: { tab: PaletteTab; count: number };
}

export const PER_TAB = 5;
export const RECENT = 5;
const NEEDS_YOU = 5;
const SUGGESTED = 6;

const label = (tab: PaletteTab) =>
  PALETTE_TABS.find((t) => t.id === tab)?.label ?? tab;

export const boostFor = (usage: Usage, now: number) => (c: PaletteCommand) =>
  usageBoost(usage[c.id], now);

// What a query finds in All: each tab's best few under its heading, the
// strongest group first, with how many more its tab holds. Conversations are
// the caller's, to put last.
export function allSections(
  commands: PaletteCommand[],
  query: string,
  usage: Usage,
  now: number
): Section[] {
  const scored = scoreCommands(commands, query, boostFor(usage, now));
  const byTab = new Map<PaletteTab, typeof scored>();
  for (const m of scored) {
    const tab = tabOf(m.c);
    if (tab === "conversations") continue;
    byTab.set(tab, [...(byTab.get(tab) ?? []), m]);
  }
  return [...byTab.entries()]
    .sort((a, b) => b[1][0].score - a[1][0].score)
    .map(([tab, ms]) => ({
      name: label(tab),
      items: ms.slice(0, PER_TAB).map((m) => m.c),
      ...(ms.length > PER_TAB
        ? { more: { tab, count: ms.length } }
        : undefined),
    }));
}

// One tab's commands, for a query or (ordered by use) without one.
export function tabItems(
  commands: PaletteCommand[],
  tab: PaletteTab,
  query: string,
  usage: Usage,
  now: number
): PaletteCommand[] {
  return scoreCommands(
    commands.filter((c) => tabOf(c) === tab),
    query,
    boostFor(usage, now)
  ).map((m) => m.c);
}

// The short list All opens on: the last things run, sessions that need the
// user or are working, and what the focused session can do.
export function emptySections(
  commands: PaletteCommand[],
  usage: Usage
): Section[] {
  const seen = new Set<string>();
  const take = (items: PaletteCommand[], limit: number) => {
    const out: PaletteCommand[] = [];
    for (const c of items) {
      if (out.length >= limit) break;
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      out.push(c);
    }
    return out;
  };
  // A session that needs you is listed there, not also under Recent.
  const rank = (c: PaletteCommand) => (c.status === "waiting" ? 0 : 1);
  const busy = take(
    commands.filter((c) => c.status).sort((a, b) => rank(a) - rank(b)),
    NEEDS_YOU
  );
  const here = take(commands.filter(actsOnFocusedSession), 5);
  const byId = new Map(commands.map((c) => [c.id, c]));
  const recent = take(
    recentIds(usage, commands.length)
      .map((id) => byId.get(id))
      .filter((c): c is PaletteCommand => !!c),
    RECENT
  );
  const sections: Section[] = [
    { name: "Recent", items: recent },
    { name: "Needs you / running", items: busy },
    { name: "This session", items: here },
  ];
  // A first run has no history: offer the commands that start things.
  if (recent.length + busy.length + here.length < 4)
    sections.push({
      name: "Suggested",
      items: take(
        commands.filter((c) => tabOf(c) === "commands"),
        SUGGESTED
      ),
    });
  return sections.filter((s) => s.items.length);
}

// Each cut-short section ends with a row that opens its whole tab.
export function withSeeAll(
  sections: Section[],
  open: (tab: PaletteTab) => void,
  icon?: unknown
): Section[] {
  return sections.map((s) => {
    const more = s.more;
    if (!more) return s;
    return {
      ...s,
      items: [
        ...s.items,
        {
          id: `see-all:${more.tab}`,
          title: `See all ${more.count} →`,
          group: s.name,
          icon,
          keepOpen: true,
          run: () => open(more.tab),
        },
      ],
    };
  });
}

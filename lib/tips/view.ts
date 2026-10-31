import { readCompletedAt } from "@/lib/welcome";
import { tipApplies } from "./conditions";
import { loadTips } from "./load";
import { orderDeck, pickToday } from "./pick";
import type { ClientTip, Tip, TipsView } from "./schema";
import { guideUrl } from "@/lib/guides";
import {
  readPinned,
  readSeen,
  setTipsOff,
  tipsOff,
  writePinned,
  writeSeen,
} from "./state";

export { guideUrl };

const forClient = ({ id, title, body, guide, media }: Tip): ClientTip => ({
  id,
  title,
  body,
  ...(guide && { url: guideUrl(guide) }),
  ...(media && { media }),
});

export const todayLocal = () => new Date().toLocaleDateString("sv");

/** The tips that apply now, and which one is today's. */
export function tipsView(day: string = todayLocal()): TipsView {
  const quiet = readCompletedAt() === null;
  if (tipsOff()) return { off: true, quiet, today: null, deck: [] };
  const deck = orderDeck(loadTips().filter((t) => tipApplies(t)));
  const pinned = readPinned();
  const today = pickToday({ deck, seen: readSeen(), pinned, day });
  if (today && (today.id !== pinned?.id || today.day !== pinned?.day))
    writePinned(today);
  return {
    off: false,
    quiet,
    today: today && { id: today.id, read: today.read },
    deck: deck.map(forClient),
  };
}

/** Records that these tips were shown; today's one becomes read. */
export function markSeen(ids: string[], day: string = todayLocal()): void {
  const known = new Set(loadTips().map((t) => t.id));
  const seen = Object.fromEntries(
    Object.entries(readSeen()).filter(([id]) => known.has(id))
  );
  for (const id of ids) if (known.has(id)) seen[id] = day;
  writeSeen(seen);
  const pinned = readPinned();
  if (pinned && pinned.day === day && ids.includes(pinned.id) && !pinned.read)
    writePinned({ ...pinned, read: true });
}

export { setTipsOff };

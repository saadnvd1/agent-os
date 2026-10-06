import type { LumifyHubClient } from "../lumifyhub/client";
import { connectedClient } from "../lumifyhub/connection";
import type { LhCard } from "../lumifyhub/types";
import { workspaceProjects } from "./brief";
import { READ_CHAR_CAP } from "./read";

type CardReader = Pick<LumifyHubClient, "listCards">;

function cardLine(c: LhCard): string {
  const ticket = c.ticket ? `${c.ticket} ` : "";
  const blocked = c.blocked_by?.length
    ? ` (blocked by ${c.blocked_by.map((b) => b.ticket ?? b.id).join(", ")})`
    : "";
  const done = c.completed ? " ✓" : "";
  return `  - ${ticket}${c.title}${blocked}${done}`;
}

// One board's cards, grouped by list in board order.
export function describeBoard(title: string, cards: LhCard[]): string {
  if (!cards.length) return `${title}: no cards`;
  const lists = new Map<string, LhCard[]>();
  for (const c of [...cards].sort((a, b) => a.position - b.position)) {
    const list = c.list_name ?? "Unlisted";
    lists.set(list, [...(lists.get(list) ?? []), c]);
  }
  return [
    `${title} (${cards.length} cards):`,
    ...[...lists].map(
      ([list, cs]) => `${list}:\n${cs.map(cardLine).join("\n")}`
    ),
  ].join("\n");
}

// The cards on the workspace's linked boards, or on one of them by board
// or project name.
export async function readCards(
  workspaceId: string,
  board?: string,
  client: CardReader | null = connectedClient()
): Promise<string> {
  const linked = workspaceProjects(workspaceId).filter((p) => p.lh_board_id);
  if (!linked.length)
    return "No project in this workspace has a LumifyHub board linked.";
  if (!client) return "LumifyHub is not connected.";
  const want = board?.trim().toLowerCase();
  const picked = want
    ? linked.filter(
        (p) =>
          p.name.toLowerCase() === want ||
          p.lh_board_name?.toLowerCase() === want ||
          p.lh_board_id === board?.trim()
      )
    : linked;
  if (!picked.length) {
    const names = linked.map((p) => p.lh_board_name ?? p.name).join(", ");
    return `No board "${board}". Linked boards: ${names}.`;
  }
  const parts = await Promise.all(
    picked.map(async (p) => {
      const title = `${p.lh_board_name ?? "Board"} (project ${p.name})`;
      try {
        return describeBoard(title, await client.listCards(p.lh_board_id!));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return `${title}: couldn't read cards (${message})`;
      }
    })
  );
  const text = parts.join("\n\n");
  return text.length > READ_CHAR_CAP
    ? `${text.slice(0, READ_CHAR_CAP - 1)}…`
    : text;
}

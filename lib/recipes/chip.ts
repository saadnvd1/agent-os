// What a session's row says about the recipe run or feature piece it is.
// Pure, for the client: the list query carries both as JSON.

export interface RowGroup {
  kind: "recipe" | "feature";
  id: string;
  text: string;
}

interface Carries {
  recipe_run?: string | null;
  feature_piece?: string | null;
}

function read<T>(json: string | null | undefined): T | null {
  try {
    return json ? (JSON.parse(json) as T) : null;
  } catch {
    return null;
  }
}

export function rowGroup(s: Carries): RowGroup | null {
  const run = read<{ id: string; name: string; seq: number }>(s.recipe_run);
  if (run)
    return { kind: "recipe", id: run.id, text: `${run.name} #${run.seq}` };
  const piece = read<{
    feature: string;
    name: string;
    position: number;
    total: number;
  }>(s.feature_piece);
  if (piece && piece.total > 1)
    return {
      kind: "feature",
      id: piece.feature,
      text: `Piece ${piece.position}/${piece.total} · ${piece.name}`,
    };
  return null;
}

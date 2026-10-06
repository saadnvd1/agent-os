// Display order for a stack's tree: each item right under its parent,
// siblings in plan order. Pure, for the browser.

export function treeOrder<T extends { id: string; parentId: string | null }>(
  items: T[]
): T[] {
  const ids = new Set(items.map((i) => i.id));
  const children = new Map<string | null, T[]>();
  for (const item of items) {
    const parent =
      item.parentId && ids.has(item.parentId) ? item.parentId : null;
    children.set(parent, [...(children.get(parent) ?? []), item]);
  }
  const out: T[] = [];
  const seen = new Set<string>();
  const walk = (parent: string | null) => {
    for (const item of children.get(parent) ?? []) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      out.push(item);
      walk(item.id);
    }
  };
  walk(null);
  return out;
}

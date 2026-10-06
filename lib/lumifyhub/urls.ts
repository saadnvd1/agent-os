// LumifyHub web addresses. Pure, so the browser can build them too.

export function workspaceUrl(baseUrl: string, slug: string): string {
  return `${baseUrl}/p/${encodeURIComponent(slug)}`;
}

export function boardUrl(
  baseUrl: string,
  slug: string,
  pageId: string | null
): string {
  const ws = workspaceUrl(baseUrl, slug);
  return pageId ? `${ws}/${encodeURIComponent(pageId)}` : ws;
}

export function cardUrl(
  baseUrl: string,
  slug: string,
  pageId: string | null,
  cardId: string
): string {
  return `${boardUrl(baseUrl, slug, pageId)}?card=${encodeURIComponent(cardId)}`;
}

export function pageUrl(baseUrl: string, slug: string, pageId: string): string {
  return `${workspaceUrl(baseUrl, slug)}/${encodeURIComponent(pageId)}`;
}

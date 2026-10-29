// The readable part of a session's address (`/s/<slug>-<id8>`). Cosmetic:
// only the short id resolves, so the slug is rebuilt from the current name
// and a rename never breaks a link. No imports: the browser uses it too.

export const SLUG_MAX = 48;
export const SHORT_ID_LEN = 8;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isUuid = (id: string): boolean => UUID.test(id);

/** Lowercase ASCII words joined by `-`; `session` when nothing is left. */
export function sessionSlug(name: string): string {
  const words = (name ?? "")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!words) return "session";
  if (words.length <= SLUG_MAX) return words;
  const cut = words.slice(0, SLUG_MAX);
  const atWord = cut.lastIndexOf("-");
  return (atWord > 0 ? cut.slice(0, atWord) : cut).replace(/-+$/, "");
}

/** The first group of a uuid, lowercase. */
export const shortId = (id: string): string =>
  id.slice(0, SHORT_ID_LEN).toLowerCase();

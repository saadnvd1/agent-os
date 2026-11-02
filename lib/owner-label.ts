// How the installation owner is named in text. Pure, so client code can use
// it; lib/owner.ts reads the stored name.
export const OWNER_NAME_MAX = 40;

export function cleanOwnerName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw
    .normalize("NFKC")
    .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}`]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
  return s ? [...s].slice(0, OWNER_NAME_MAX).join("") : null;
}

/** Agent prompts: the name, else "the owner". */
export const ownerInPrompt = (name: string | null, cap = false) =>
  name ?? (cap ? "The owner" : "the owner");

/** UI text: the name, else "you". */
export const ownerInUi = (name: string | null, cap = false) =>
  name ?? (cap ? "You" : "you");

/** "Alex decides" / "You decide": the verb for a name or for "you". */
export const ownerVerb = (name: string | null, named: string, you: string) =>
  `${ownerInUi(name, true)} ${name ? named : you}`;

import type { SharePreview } from "@/data/shares";

const PLURAL: Record<keyof SharePreview["hits"], [string, string]> = {
  secret: ["secret", "secrets"],
  path: ["path", "paths"],
  ip: ["address", "addresses"],
  host: ["host", "hosts"],
  email: ["email", "emails"],
};

/** "Masked: 3 secrets, 12 paths", or "" when nothing was. */
export function redactionSummary(hits: SharePreview["hits"]): string {
  const parts = (Object.keys(PLURAL) as (keyof typeof PLURAL)[])
    .filter((k) => hits[k] > 0)
    .map((k) => `${hits[k]} ${PLURAL[k][hits[k] === 1 ? 0 : 1]}`);
  return parts.length ? `Masked: ${parts.join(", ")}` : "";
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} bytes`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** A file name for a download: the title, plain, with .html. */
export function fileName(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `${slug || "shared"}.html`;
}

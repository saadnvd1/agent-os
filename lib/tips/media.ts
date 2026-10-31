import fs from "fs";
import path from "path";
import { fileSchema, type Media, type MediaBrief, type Tip } from "./schema";

export const MEDIA_DIR = "public/tips";
export const BUDGET = {
  still: 90 * 1024,
  clip: 500 * 1024,
  poster: 40 * 1024,
  total: 6 * 1024 * 1024,
  clipSeconds: 8,
  width: 768,
} as const;

/** The files a media value points at, as names inside public/tips. */
export function mediaFiles(m: Media): { name: string; max: number }[] {
  const name = (src: string) => path.basename(src);
  return m.kind === "image"
    ? [
        { name: name(m.src), max: BUDGET.still },
        ...(m.srcDark ? [{ name: name(m.srcDark), max: BUDGET.still }] : []),
      ]
    : [
        { name: name(m.src), max: BUDGET.clip },
        { name: name(m.poster), max: BUDGET.poster },
      ];
}

export interface ManifestRow {
  id: string;
  title: string;
  kind: MediaBrief["kind"];
  shot: string;
  theme: NonNullable<MediaBrief["theme"]>;
  guide?: string;
  target: { width: number; maxBytes: number; maxSeconds?: number };
  dest: string;
}

/** What Luna still has to make: tips with a brief and no media yet. */
export function manifest(tips: Tip[]): ManifestRow[] {
  return tips
    .filter((t) => t.mediaBrief && !t.media)
    .map((t) => {
      const b = t.mediaBrief!;
      const clip = b.kind === "clip";
      return {
        id: t.id,
        title: t.title,
        kind: b.kind,
        shot: b.shot,
        theme: b.theme ?? (clip ? "dark" : "both"),
        ...(t.guide && { guide: t.guide.file }),
        target: {
          width: BUDGET.width,
          maxBytes: clip ? BUDGET.clip : BUDGET.still,
          ...(clip && { maxSeconds: BUDGET.clipSeconds }),
        },
        dest: `${MEDIA_DIR}/${t.id}.${clip ? "mp4" : "webp"}`,
      };
    });
}

/**
 * Copies the finished files from `from` into `root`/public/tips and writes each
 * tip's `media` (dropping its brief). Throws before changing anything if an id
 * is unknown, a file is missing, or a file is over its budget.
 */
export function applyHandback(
  root: string,
  from: string,
  handback: Record<string, Media>
): string[] {
  const file = path.join(root, "content/tips.json");
  const parsed = fileSchema.parse(JSON.parse(fs.readFileSync(file, "utf-8")));
  const copies: [string, string][] = [];
  for (const [id, media] of Object.entries(handback)) {
    if (!parsed.tips.some((t) => t.id === id))
      throw new Error(`Unknown tip "${id}"`);
    for (const { name, max } of mediaFiles(media)) {
      const src = path.join(from, name);
      if (!fs.existsSync(src)) throw new Error(`${id}: ${name} is missing`);
      const size = fs.statSync(src).size;
      if (size > max)
        throw new Error(`${id}: ${name} is ${size} bytes, over ${max}`);
      copies.push([src, path.join(root, MEDIA_DIR, name)]);
    }
    if (media.kind === "video" && media.durationMs > BUDGET.clipSeconds * 1000)
      throw new Error(`${id}: clip is longer than ${BUDGET.clipSeconds}s`);
  }
  fs.mkdirSync(path.join(root, MEDIA_DIR), { recursive: true });
  for (const [a, b] of copies) fs.copyFileSync(a, b);
  const tips = parsed.tips.map((t) => {
    const media = handback[t.id];
    if (!media) return t;
    const { mediaBrief: _brief, ...rest } = t;
    return { ...rest, media };
  });
  fs.writeFileSync(file, JSON.stringify({ ...parsed, tips }, null, 2) + "\n");
  return Object.keys(handback);
}

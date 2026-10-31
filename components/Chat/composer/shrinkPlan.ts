// The decisions behind shrinking a big photo before it is attached, kept pure
// so they can be tested without a canvas.

export const MAX_EDGE = 2000;
const FALLBACK_EDGE = 1600;

export interface ShrinkStep {
  maxEdge: number;
  quality: number;
}

// Tried in order until the result fits the cap.
export const SHRINK_STEPS: ShrinkStep[] = [
  { maxEdge: MAX_EDGE, quality: 0.85 },
  { maxEdge: MAX_EDGE, quality: 0.75 },
  { maxEdge: MAX_EDGE, quality: 0.65 },
  { maxEdge: FALLBACK_EDGE, quality: 0.75 },
  { maxEdge: FALLBACK_EDGE, quality: 0.65 },
];

export const needsShrink = (
  width: number,
  height: number,
  bytes: number,
  cap: number
) => bytes > cap || Math.max(width, height) > MAX_EDGE;

// Fit inside maxEdge on the long side; never enlarge.
export function targetSize(width: number, height: number, maxEdge: number) {
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

// photo.HEIC -> photo.jpg; a name without an extension just gains one.
export const renamed = (name: string, ext: "jpg" | "png") =>
  `${name.replace(/\.[^./\\]+$/, "")}.${ext}`;

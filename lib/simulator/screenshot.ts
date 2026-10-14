/**
 * Cheaper screenshots for the agent: every image it reads costs tokens on
 * every later turn, so it reads a copy capped at READ_SIZE px (or just one
 * element of the screen) while the full-size file stays for the PR.
 */

import { execFile } from "child_process";
import fs from "fs";
import path from "path";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

export const READ_SIZE = 800;
// Points of context kept around a cropped element.
export const REGION_MARGIN = 8;

export type Sips = (args: string[]) => Promise<string>;

const realSips: Sips = async (args) =>
  (await execFileAsync("sips", args, { timeout: 30_000 })).stdout;
let sips: Sips = realSips;
export const setSips = (fn: Sips | null) => {
  sips = fn ?? realSips;
};

export interface Frame {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface Crop {
  x: number;
  y: number;
  width: number;
  height: number;
}

export class RegionError extends Error {}

// Where the agent reads from: a copy under shots/read, so the shots strip and
// the PR files stay the full-size ones.
export const readCopyPath = (full: string) =>
  path.join(path.dirname(full), "read", path.basename(full));

async function pixelSize(file: string) {
  const out = await sips(["-g", "pixelWidth", "-g", "pixelHeight", file]);
  const w = Number(/pixelWidth:\s*(\d+)/.exec(out)?.[1]);
  const h = Number(/pixelHeight:\s*(\d+)/.exec(out)?.[1]);
  if (!w || !h) throw new Error("cannot read image size");
  return { width: w, height: h };
}

// The reduced copy, or the full file when resizing fails.
export async function reducedCopy(full: string): Promise<string> {
  const out = readCopyPath(full);
  try {
    fs.mkdirSync(path.dirname(out), { recursive: true });
    await sips(["-Z", String(READ_SIZE), full, "--out", out]);
    return fs.existsSync(out) ? out : full;
  } catch {
    return full;
  }
}

// An element's frame (points) to a pixel rectangle of the image, with a
// margin, clamped to the image. `screen` is the size of the frame's space.
export function cropRect(
  frame: Frame,
  screen: { width: number; height: number },
  image: { width: number; height: number },
  margin = REGION_MARGIN
): Crop {
  const sx = image.width / screen.width;
  const sy = image.height / screen.height;
  const x0 = Math.max(0, Math.floor((frame.x - margin) * sx));
  const y0 = Math.max(0, Math.floor((frame.y - margin) * sy));
  const x1 = Math.min(
    image.width,
    Math.ceil((frame.x + frame.width + margin) * sx)
  );
  const y1 = Math.min(
    image.height,
    Math.ceil((frame.y + frame.height + margin) * sy)
  );
  if (x1 <= x0 || y1 <= y0)
    throw new RegionError("that element is off the screen");
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

type Node = { ref?: unknown; rect?: Frame };

// Every node with a ref and a rect, wherever the JSON nests them.
function nodesOf(value: unknown, out: Node[] = []): Node[] {
  if (Array.isArray(value)) value.forEach((v) => nodesOf(v, out));
  else if (value && typeof value === "object") {
    const n = value as Node;
    if (typeof n.ref === "string" && n.rect) out.push(n);
    for (const v of Object.values(value)) nodesOf(v, out);
  }
  return out;
}

const isFrame = (r: unknown): r is Frame =>
  !!r &&
  ["x", "y", "width", "height"].every(
    (k) => typeof (r as Record<string, unknown>)[k] === "number"
  );

// The frame of `ref` in a `snapshot -i --json` output, and the screen size
// (the widest, tallest frame: the app's window).
export function frameOf(
  json: string,
  ref: string
): { frame: Frame; screen: { width: number; height: number } } {
  let nodes: Node[];
  try {
    nodes = nodesOf(JSON.parse(json)).filter((n) => isFrame(n.rect));
  } catch {
    throw new RegionError(
      "could not read the snapshot; run `aos sim snapshot -i`"
    );
  }
  const want = ref.replace(/^@/, "");
  const hit = nodes.find((n) => String(n.ref).replace(/^@/, "") === want);
  if (!hit)
    throw new RegionError(
      `unknown or stale ref @${want}: run \`aos sim snapshot -i\` and use a ref from it`
    );
  const screen = nodes.reduce(
    (s, n) => ({
      width: Math.max(s.width, n.rect!.x + n.rect!.width),
      height: Math.max(s.height, n.rect!.y + n.rect!.height),
    }),
    { width: 0, height: 0 }
  );
  return { frame: hit.rect!, screen };
}

// Crops `file` in place to the rectangle.
export async function cropInPlace(file: string, c: Crop): Promise<void> {
  await sips([
    "--cropToHeightWidth",
    String(c.height),
    String(c.width),
    "--cropOffset",
    String(c.y),
    String(c.x),
    file,
  ]);
}

export async function cropToFrame(
  file: string,
  frame: Frame,
  screen: { width: number; height: number }
): Promise<void> {
  await cropInPlace(file, cropRect(frame, screen, await pixelSize(file)));
}

// `--region <ref>` / `--region=<ref>` out of a screenshot's args.
export function takeRegion(args: string[]): {
  args: string[];
  region: string | null;
} {
  const rest: string[] = [];
  let region: string | null = null;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--region") {
      region = args[++i] ?? "";
      if (!region) throw new RegionError("--region needs a ref, like @e3");
    } else if (a.startsWith("--region=")) region = a.slice(9);
    else rest.push(a);
  }
  if (region !== null && !/^@?e?\d+$/.test(region) && !/^@\S+$/.test(region))
    throw new RegionError("--region takes a ref from `aos sim snapshot -i`");
  return { args: rest, region };
}

import fs from "node:fs";
import path from "node:path";

const CODE = /\.(?:[cm]?[jt]sx?)$/;
const SPECIFIER =
  /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bvi\.(?:mock|doMock|importActual)\s*\(\s*|\bimport\s+)["']([^"']+)["']/g;
const SUFFIXES = [
  "",
  ".ts",
  ".tsx",
  ".mts",
  ".mjs",
  ".js",
  "/index.ts",
  "/index.tsx",
  "/index.mjs",
  "/index.js",
];

export const isCode = (file: string) => CODE.test(file);

export function specifiers(source: string): string[] {
  return [...source.matchAll(SPECIFIER)].map((m) => m[1]);
}

// Which tracked file a specifier means, or null for packages and node:.
export function resolveSpecifier(
  from: string,
  spec: string,
  known: Set<string>
): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = spec.slice(2);
  else if (spec.startsWith("."))
    base = path.posix.normalize(
      path.posix.join(path.posix.dirname(from), spec)
    );
  else return null;
  for (const suffix of SUFFIXES)
    if (known.has(base + suffix)) return base + suffix;
  return null;
}

export interface Graph {
  // file → the files that import it
  importers: Map<string, Set<string>>;
  read: (file: string) => string;
}

export function buildGraph(root: string, files: string[]): Graph {
  const known = new Set(files);
  const importers = new Map<string, Set<string>>();
  const texts = new Map<string, string>();
  const read = (file: string) => {
    let text = texts.get(file);
    if (text === undefined) {
      try {
        text = fs.readFileSync(path.join(root, file), "utf8");
      } catch {
        text = "";
      }
      texts.set(file, text);
    }
    return text;
  };
  for (const file of files) {
    if (!isCode(file)) continue;
    for (const spec of specifiers(read(file))) {
      const target = resolveSpecifier(file, spec, known);
      if (!target) continue;
      let set = importers.get(target);
      if (!set) importers.set(target, (set = new Set()));
      set.add(file);
    }
  }
  return { importers, read };
}

// A file and everything that reaches it through imports.
export function reachedFrom(
  start: Iterable<string>,
  importers: Map<string, Set<string>>
): Set<string> {
  const seen = new Set<string>(start);
  const queue = [...seen];
  for (let file = queue.pop(); file !== undefined; file = queue.pop())
    for (const parent of importers.get(file) ?? [])
      if (!seen.has(parent)) {
        seen.add(parent);
        queue.push(parent);
      }
  return seen;
}

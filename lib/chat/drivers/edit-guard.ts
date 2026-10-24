import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { agentosHome } from "../../agentos-home";

// What a model needs after an edit goes wrong, for Pi and OpenCode alike
// (their edit tools are theirs, so this runs beside them as an extension and
// a plugin):
//
// - an edit whose old text isn't in the file is refused before it runs, with
//   the file's current text around the closest match, and a repeat of an edit
//   that already failed is called out;
// - after an edit or write to a TypeScript or JavaScript file, new syntax
//   errors and block-scoped names declared twice come back in the tool result.
//
// Plain ESM with no imports beyond node's, so Node (Pi) and Bun (OpenCode)
// both run it. It never throws and never blocks on anything it can't read.
// Written as a string, like the other extensions, and exported for its test.
export const EDIT_GUARD_LIB = String.raw`import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { extname, resolve } from "node:path";

const SOURCE = new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"]);
const MAX_BYTES = 1048576;
const MAX_REPORTED = 10;
const EXCERPT_LINES = 40;
const EXCERPT_CHARS = 3000;

const norm = (s) => String(s).replace(/\r\n/g, "\n");
const trimmed = (s) => norm(s).split("\n").map((l) => l.trim());
const collapse = (s) => norm(s).replace(/\s+/g, " ").trim();

export function readText(file) {
  try {
    if (statSync(file).size > MAX_BYTES) return null;
    return readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

export const absolute = (file, cwd) =>
  resolve(cwd || process.cwd(), String(file).replace(/^@/, ""));

function needLines(old) {
  const need = trimmed(old);
  while (need.length && need[need.length - 1] === "") need.pop();
  while (need.length && need[0] === "") need.shift();
  return need;
}

// Whether any of the harnesses' matchers could find this text: exact, line by
// line without indentation, with whitespace collapsed, or by its first and
// last lines. Only text none of them find is refused, so an edit a harness
// would have accepted is never blocked here.
export function isFound(text, old) {
  if (typeof old !== "string" || !old.trim()) return true;
  if (text.includes(old) || norm(text).includes(norm(old))) return true;
  const hay = trimmed(text);
  const need = needLines(old);
  if (!need.length) return true;
  for (let i = 0; i + need.length <= hay.length; i++) {
    let same = true;
    for (let j = 0; j < need.length && same; j++) same = hay[i + j] === need[j];
    if (same) return true;
  }
  if (collapse(text).includes(collapse(old))) return true;
  if (need.length >= 3) {
    const last = need[need.length - 1];
    for (let i = 0; i < hay.length; i++) {
      if (hay[i] !== need[0]) continue;
      const to = Math.min(hay.length, i + need.length + 10);
      for (let k = i + 2; k < to; k++) if (hay[k] === last) return true;
    }
  }
  return false;
}

// The file's lines around where the old text most likely was, numbered, or
// null when nothing in the file resembles it.
export function closestMatch(text, old) {
  const lines = norm(text).split("\n");
  const hay = lines.map((l) => l.trim());
  const need = trimmed(old);
  const real = need.filter((l) => l.length > 2);
  if (!real.length) return null;
  const anchor = real.reduce((a, b) => (b.length > a.length ? b : a));
  const offset = need.indexOf(anchor);
  let hits = [];
  hay.forEach((l, i) => l === anchor && hits.push(i));
  if (!hits.length) hay.forEach((l, i) => l.length > 2 && (l.includes(anchor) || anchor.includes(l)) && hits.push(i));
  if (!hits.length) {
    const words = (l) => new Set(l.toLowerCase().split(/[^a-z0-9_$]+/).filter(Boolean));
    const want = words(anchor);
    let top = 0.5;
    hay.forEach((l, i) => {
      const have = words(l);
      let shared = 0;
      for (const w of have) if (want.has(w)) shared++;
      const dice = (2 * shared) / (want.size + have.size || 1);
      if (dice > top) {
        top = dice;
        hits = [i];
      }
    });
  }
  if (!hits.length) return null;
  let best = { score: -1, start: 0 };
  for (const h of hits.slice(0, 200)) {
    const start = Math.max(0, h - offset);
    let score = 0;
    for (let j = 0; j < need.length; j++) if (hay[start + j] === need[j] && need[j]) score++;
    if (score > best.score) best = { score, start };
  }
  const from = Math.max(0, best.start - 3);
  const to = Math.min(lines.length, best.start + need.length + 3);
  let shown = lines.slice(from, to);
  if (shown.length > EXCERPT_LINES) shown = shown.slice(0, EXCERPT_LINES);
  let excerpt = shown.map((l, i) => (from + i + 1) + "\t" + l).join("\n");
  if (excerpt.length > EXCERPT_CHARS) excerpt = excerpt.slice(0, EXCERPT_CHARS) + "\n…";
  return { from: from + 1, to: from + shown.length, excerpt };
}

export function failureMessage(file, old, text, repeat) {
  const near = closestMatch(text, old);
  const out = [
    "The old text was not found in " + file + ". The file is not what this edit assumes: it changed since you last read it, or the text is not exactly what is there.",
  ];
  if (repeat >= 2)
    out.push("This is the same edit (same file, same old text) that has already failed " + (repeat - 1) + " time" + (repeat > 2 ? "s" : "") + ". Do not send it again unchanged.");
  if (near) out.push("The file's current text near the closest match (lines " + near.from + "-" + near.to + "):", near.excerpt);
  else out.push("Nothing in the file resembles that text (" + norm(text).split("\n").length + " lines).");
  out.push("Read " + file + " again and build the edit from what is there now.");
  return out.join("\n");
}

// Failed edits by file and old text, so a repeat can be named. A read, a
// successful edit or a write of the file starts it over.
export class FailureLog {
  constructor() {
    this.counts = new Map();
  }
  key(file, old) {
    return file + "\0" + createHash("sha1").update(String(old)).digest("hex");
  }
  record(file, old) {
    const key = this.key(file, old);
    const n = (this.counts.get(key) || 0) + 1;
    this.counts.set(key, n);
    return n;
  }
  clear(file) {
    for (const key of [...this.counts.keys()]) if (key.startsWith(file + "\0")) this.counts.delete(key);
  }
}

// The refusal for an edit whose old text isn't in the file, or null to let
// it run. Several edits to one file: the first missing one is named.
export function guardEdit(log, file, oldTexts, cwd) {
  try {
    const path = absolute(file, cwd);
    const text = readText(path);
    if (text == null) return null;
    const missing = oldTexts.find((o) => !isFound(text, o));
    if (missing === undefined) return null;
    return failureMessage(file, missing, text, log.record(path, missing));
  } catch {
    return null;
  }
}

const tsByRoot = new Map();
function loadTs(cwd) {
  const root = resolve(cwd || process.cwd());
  const cacheKey = root + "|" + (process.env.AGENTOS_TYPESCRIPT || "");
  if (tsByRoot.has(cacheKey)) return tsByRoot.get(cacheKey);
  let found = null;
  const tries = [
    () => createRequire(resolve(root, "package.json"))("typescript"),
    () => (process.env.AGENTOS_TYPESCRIPT ? createRequire(import.meta.url)(process.env.AGENTOS_TYPESCRIPT) : null),
  ];
  for (const t of tries) {
    try {
      const m = t();
      if (m && typeof m.createSourceFile === "function") {
        found = m;
        break;
      }
    } catch {}
  }
  tsByRoot.set(cacheKey, found);
  return found;
}

function bindingNames(ts, name, out) {
  if (ts.isIdentifier(name)) out.push(name);
  else for (const el of name.elements) if (!ts.isOmittedExpression(el)) bindingNames(ts, el.name, out);
}

function duplicates(ts, sf) {
  const found = [];
  const check = (statements) => {
    const lexical = new Map();
    const hoisted = new Map();
    const add = (map, id, kind) => {
      const line = sf.getLineAndCharacterOfPosition(id.getStart(sf)).line + 1;
      if (!map.has(id.text)) map.set(id.text, []);
      map.get(id.text).push({ kind, line });
    };
    for (const st of statements) {
      if (ts.isVariableStatement(st)) {
        const flags = st.declarationList.flags;
        const kind = flags & ts.NodeFlags.Const ? "const" : flags & ts.NodeFlags.Let ? "let" : "var";
        const ids = [];
        for (const d of st.declarationList.declarations) bindingNames(ts, d.name, ids);
        for (const id of ids) add(kind === "var" ? hoisted : lexical, id, kind);
      } else if (ts.isClassDeclaration(st) && st.name) add(lexical, st.name, "class");
      else if (ts.isFunctionDeclaration(st) && st.name) add(hoisted, st.name, "function");
    }
    for (const [name, at] of lexical) {
      const all = at.concat(hoisted.get(name) || []);
      if (all.length > 1) found.push({ name, kind: at[0].kind, lines: all.map((a) => a.line).sort((a, b) => a - b) });
    }
  };
  const visit = (node) => {
    if (ts.isSourceFile(node) || ts.isBlock(node) || ts.isModuleBlock(node)) check(node.statements);
    else if (ts.isCaseBlock(node)) check(node.clauses.flatMap((c) => [...c.statements]));
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

function problems(ts, file, text) {
  const out = [];
  const t = ts.transpileModule(text, {
    fileName: file,
    reportDiagnostics: true,
    compilerOptions: { jsx: ts.JsxEmit.Preserve, target: ts.ScriptTarget.Latest, isolatedModules: true },
  });
  for (const d of t.diagnostics || []) {
    const at = d.file && d.start != null ? d.file.getLineAndCharacterOfPosition(d.start) : null;
    const message = ts.flattenDiagnosticMessageText(d.messageText, " ");
    out.push({ key: message, text: (at ? (at.line + 1) + ":" + (at.character + 1) + " " : "") + message });
  }
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  for (const d of duplicates(ts, sf))
    out.push({
      key: "duplicate " + d.name,
      text: d.kind + " " + d.name + " is declared more than once in the same block (lines " + d.lines.join(", ") + ")",
    });
  return out;
}

// What an edit broke in a source file: the problems it has now that it didn't
// before, as text for the tool result, or "" when there are none, the file
// isn't source, or TypeScript can't be loaded. Syntax only, never types.
export function syntaxReport(file, before, after, cwd) {
  try {
    if (!SOURCE.has(extname(file).toLowerCase()) || typeof after !== "string" || after.length > MAX_BYTES) return "";
    const ts = loadTs(cwd);
    if (!ts) return "";
    const had = new Map();
    for (const p of before == null || before.length > MAX_BYTES ? [] : problems(ts, file, before)) had.set(p.key, (had.get(p.key) || 0) + 1);
    const fresh = [];
    for (const p of problems(ts, file, after)) {
      const n = had.get(p.key) || 0;
      if (n > 0) had.set(p.key, n - 1);
      else fresh.push(p);
    }
    if (!fresh.length) return "";
    const shown = fresh.slice(0, MAX_REPORTED).map((p) => "- " + p.text);
    if (fresh.length > shown.length) shown.push("- and " + (fresh.length - shown.length) + " more");
    return "[AgentOS syntax check] This change left problems in " + file + " that were not there before. Fix them now:\n" + shown.join("\n");
  } catch {
    return "";
  }
}
`;

const dir = () => agentosHome("edit-guard");

// Owner-only, like the other extension folders.
export function writeEditGuard(
  name: string,
  source: string,
  folder = dir()
): string {
  fs.mkdirSync(folder, { recursive: true, mode: 0o700 });
  fs.chmodSync(folder, 0o700);
  for (const [file, text] of [
    ["agentos-edit-guard-lib.mjs", EDIT_GUARD_LIB],
    [name, source],
  ]) {
    const target = path.join(folder, file);
    if (!fs.existsSync(target) || fs.readFileSync(target, "utf8") !== text)
      fs.writeFileSync(target, text);
  }
  return path.join(folder, name);
}

// The TypeScript this server runs on, for projects that have none of their
// own, or undefined where there isn't one.
export function typescriptPath(): string | undefined {
  try {
    return createRequire(import.meta.url).resolve("typescript");
  } catch {
    return undefined;
  }
}

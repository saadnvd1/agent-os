/**
 * Collectors that read the code itself: size, duplication, shell and SQL
 * built from strings, and API routes that skip the security guards. Each
 * returns a compact summary; the audit skill reads that, not the files.
 */

import crypto from "crypto";
import ts from "typescript";
import {
  argShape,
  calleeName,
  isSource,
  lineCount,
  lineOf,
  parse,
  snippet,
  stringText,
  walk,
  type ArgShape,
  type SourceFile,
} from "./source";

export interface Sized {
  path: string;
  lines: number;
}

export function largestFiles(files: SourceFile[], limit = 20): Sized[] {
  return files
    .filter((f) => isSource(f.path))
    .map((f) => ({ path: f.path, lines: lineCount(f.text) }))
    .sort((a, b) => b.lines - a.lines || a.path.localeCompare(b.path))
    .slice(0, limit);
}

export interface SizedFunction {
  where: string;
  name: string;
  lines: number;
}

function functionName(node: ts.Node): string {
  const named = node as ts.FunctionDeclaration | ts.MethodDeclaration;
  if (named.name && ts.isIdentifier(named.name)) return named.name.text;
  const parent = node.parent;
  if (
    parent &&
    ts.isVariableDeclaration(parent) &&
    ts.isIdentifier(parent.name)
  )
    return parent.name.text;
  if (parent && ts.isPropertyAssignment(parent) && ts.isIdentifier(parent.name))
    return parent.name.text;
  if (parent && ts.isCallExpression(parent)) {
    const callee = calleeName(parent);
    return callee ? `<${callee} callback>` : "<anonymous>";
  }
  return "<anonymous>";
}

/** Functions of `min` lines or more: how many, and the longest. */
export function largestFunctions(
  files: SourceFile[],
  { limit = 25, min = 80 } = {}
): { min: number; count: number; top: SizedFunction[] } {
  const out: SizedFunction[] = [];
  for (const file of files) {
    if (!isSource(file.path)) continue;
    const sf = parse(file);
    walk(sf, (node) => {
      if (
        !ts.isFunctionDeclaration(node) &&
        !ts.isMethodDeclaration(node) &&
        !ts.isArrowFunction(node) &&
        !ts.isFunctionExpression(node)
      )
        return;
      const start = lineOf(sf, node.getStart(sf));
      const lines = lineOf(sf, node.getEnd()) - start + 1;
      if (lines >= min)
        out.push({
          where: `${file.path}:${start}`,
          name: functionName(node),
          lines,
        });
    });
  }
  return {
    min,
    count: out.length,
    top: out
      .sort((a, b) => b.lines - a.lines || a.where.localeCompare(b.where))
      .slice(0, limit),
  };
}

// Lines that say nothing about duplication: blank, braces, comments, imports.
const TRIVIAL =
  /^(?:[{}()[\];,]*|\/\/.*|\/?\*.*|import\b.*|export \{.*|\}\s*from\s.*|["'`][\w@/.-]*["'`];?)$/;

export interface DuplicateBlock {
  lines: number;
  a: string;
  b: string;
  sample: string;
}

export interface Duplicates {
  window: number;
  blocks: DuplicateBlock[];
  /** Lines inside some duplicated block, counted once per location. */
  duplicatedLines: number;
}

/**
 * Copied code: the same run of `window` meaningful lines (whitespace
 * collapsed) in two places, extended while the copies keep matching.
 */
export function duplicateBlocks(
  files: SourceFile[],
  { window = 10, limit = 20 } = {}
): Duplicates {
  const norm: { path: string; lines: string[]; at: number[] }[] = [];
  for (const file of files) {
    if (!isSource(file.path)) continue;
    const lines: string[] = [];
    const at: number[] = [];
    file.text.split("\n").forEach((raw, i) => {
      const line = raw.trim().replace(/\s+/g, " ");
      if (!TRIVIAL.test(line)) {
        lines.push(line);
        at.push(i + 1);
      }
    });
    norm.push({ path: file.path, lines, at });
  }

  const seen = new Map<string, [number, number][]>();
  norm.forEach((f, fi) => {
    for (let i = 0; i + window <= f.lines.length; i++) {
      const key = crypto
        .createHash("sha1")
        .update(f.lines.slice(i, i + window).join("\n"))
        .digest("base64");
      const list = seen.get(key);
      if (list) {
        if (list.length < 8) list.push([fi, i]);
      } else seen.set(key, [[fi, i]]);
    }
  });

  // Pairs of windows that match at the same offset are one copied block.
  const runs = new Map<string, number[]>();
  for (const list of seen.values()) {
    for (let x = 0; x < list.length; x++)
      for (let y = x + 1; y < list.length; y++) {
        const [fa, ia] = list[x];
        const [fb, ib] = list[y];
        // A window overlapping itself (repetitive code) is not a copy.
        if (fa === fb && Math.abs(ia - ib) < window) continue;
        const key = `${fa}:${fb}:${ia - ib}`;
        const r = runs.get(key);
        if (r) r.push(ia);
        else runs.set(key, [ia]);
      }
  }

  const blocks: (DuplicateBlock & { cover: [number, number, number][] })[] = [];
  for (const [key, starts] of runs) {
    const [fa, fb, delta] = key.split(":").map(Number);
    starts.sort((p, q) => p - q);
    let first = starts[0];
    for (let k = 1; k <= starts.length; k++) {
      if (k < starts.length && starts[k] === starts[k - 1] + 1) continue;
      const last = starts[k - 1] + window - 1;
      const A = norm[fa];
      const B = norm[fb];
      const range = (f: typeof A, s: number, e: number) =>
        `${f.path}:${f.at[s]}-${f.at[e]}`;
      blocks.push({
        lines: last - first + 1,
        a: range(A, first, last),
        b: range(B, first - delta, last - delta),
        sample: snippet(A.lines.slice(first, first + 3).join(" ")),
        cover: [
          [fa, first, last],
          [fb, first - delta, last - delta],
        ],
      });
      if (k < starts.length) first = starts[k];
    }
  }

  const counted = new Set<string>();
  for (const b of blocks)
    for (const [f, s, e] of b.cover)
      for (let i = s; i <= e; i++) counted.add(`${f}:${i}`);

  return {
    window,
    duplicatedLines: counted.size,
    blocks: blocks
      .sort((p, q) => q.lines - p.lines || p.a.localeCompare(q.a))
      .slice(0, limit)
      .map(({ lines, a, b, sample }) => ({ lines, a, b, sample })),
  };
}

export interface ShellCall {
  where: string;
  call: string;
  shape: ArgShape | "shell-option";
  text: string;
}

const STRING_EXEC = new Set(["exec", "execSync"]);
const ARGV_EXEC = new Set([
  "spawn",
  "spawnSync",
  "execFile",
  "execFileSync",
  "fork",
]);
const CHILD_PROCESS =
  /from\s+["'](node:)?child_process["']|require\(\s*["'](node:)?child_process["']\s*\)/;

function hasShellTrue(node: ts.Expression | undefined): boolean {
  if (!node || !ts.isObjectLiteralExpression(node)) return false;
  return node.properties.some(
    (p) =>
      ts.isPropertyAssignment(p) &&
      ts.isIdentifier(p.name) &&
      p.name.text === "shell" &&
      p.initializer.kind !== ts.SyntaxKind.FalseKeyword
  );
}

const isChildProcess = (spec: string) => /^(node:)?child_process$/.test(spec);

/**
 * The names a file calls child_process through: `exec` (or its alias) from
 * a named import or a destructured require, a namespace (`cp.exec`), and a
 * promisified copy (`execAsync = promisify(exec)`). RegExp's .exec is none
 * of these.
 */
function childProcessNames(sf: ts.SourceFile) {
  const named = new Map<string, string>();
  const spaces = new Set<string>();
  const requireOf = (e?: ts.Expression) =>
    !!e &&
    ts.isCallExpression(e) &&
    ts.isIdentifier(e.expression) &&
    e.expression.text === "require" &&
    !!e.arguments[0] &&
    ts.isStringLiteralLike(e.arguments[0]) &&
    isChildProcess(e.arguments[0].text);
  walk(sf, (node) => {
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      isChildProcess(node.moduleSpecifier.text)
    ) {
      const clause = node.importClause;
      if (clause?.name) spaces.add(clause.name.text);
      const bindings = clause?.namedBindings;
      if (bindings && ts.isNamespaceImport(bindings))
        spaces.add(bindings.name.text);
      if (bindings && ts.isNamedImports(bindings))
        for (const el of bindings.elements)
          named.set(el.name.text, (el.propertyName ?? el.name).text);
    }
    if (!ts.isVariableDeclaration(node) || !node.initializer) return;
    const init = node.initializer;
    if (requireOf(init)) {
      if (ts.isIdentifier(node.name)) spaces.add(node.name.text);
      else if (ts.isObjectBindingPattern(node.name))
        for (const el of node.name.elements)
          if (ts.isIdentifier(el.name))
            named.set(
              el.name.text,
              el.propertyName && ts.isIdentifier(el.propertyName)
                ? el.propertyName.text
                : el.name.text
            );
    }
  });
  // promisify(exec) keeps exec's meaning; a second pass sees the imports.
  walk(sf, (node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      ts.isCallExpression(node.initializer) &&
      calleeName(node.initializer) === "promisify"
    ) {
      const arg = node.initializer.arguments[0];
      const target =
        arg && ts.isIdentifier(arg) ? named.get(arg.text) : undefined;
      if (target) named.set(node.name.text, target);
    }
  });
  return { named, spaces };
}

/** The child_process function a call reaches, or null. */
function childProcessCall(
  call: ts.CallExpression,
  names: ReturnType<typeof childProcessNames>
): string | null {
  const c = call.expression;
  if (ts.isIdentifier(c)) return names.named.get(c.text) ?? null;
  if (
    ts.isPropertyAccessExpression(c) &&
    ts.isIdentifier(c.expression) &&
    names.spaces.has(c.expression.text)
  )
    return c.name.text;
  return null;
}

/**
 * Commands a shell parses: exec/execSync with a non-literal string, any
 * spawn with `shell: true`, and `sh -c` / `bash -c` given a built string.
 * Literal commands are only counted.
 */
export function shellCalls(files: SourceFile[]): {
  risky: ShellCall[];
  literal: number;
} {
  const risky: ShellCall[] = [];
  let literal = 0;
  for (const file of files) {
    if (!isSource(file.path) || !CHILD_PROCESS.test(file.text)) continue;
    const sf = parse(file);
    const names = childProcessNames(sf);
    walk(sf, (node) => {
      if (!ts.isCallExpression(node)) return;
      const name = childProcessCall(node, names);
      if (!name) return;
      const where = `${file.path}:${lineOf(sf, node.getStart(sf))}`;
      const [first, second] = node.arguments;
      if (STRING_EXEC.has(name) && first) {
        const shape = argShape(first);
        if (shape === "literal") literal++;
        else
          risky.push({
            where,
            call: name,
            shape,
            text: snippet(stringText(first)),
          });
        return;
      }
      if (!ARGV_EXEC.has(name)) return;
      if (node.arguments.slice(1).some(hasShellTrue)) {
        risky.push({
          where,
          call: name,
          shape: "shell-option",
          text: snippet(first ? stringText(first) : ""),
        });
        return;
      }
      // spawn("sh", ["-c", `… ${x}`])
      if (
        first &&
        second &&
        ts.isArrayLiteralExpression(second) &&
        /^(ba|z)?sh$/.test(
          first && ts.isStringLiteralLike(first) ? first.text : ""
        )
      ) {
        const els = second.elements;
        const c = els.findIndex(
          (e) => ts.isStringLiteralLike(e) && /^-\w*c$/.test(e.text)
        );
        const script = c >= 0 ? els[c + 1] : undefined;
        if (script && !ts.isSpreadElement(script)) {
          const shape = argShape(script);
          if (shape === "literal") literal++;
          else
            risky.push({
              where,
              call: `${name} ${(first as ts.StringLiteral).text} -c`,
              shape,
              text: snippet(stringText(script)),
            });
        }
      }
    });
  }
  risky.sort((a, b) => a.where.localeCompare(b.where));
  return { risky, literal };
}

export interface SqlBuild {
  where: string;
  call: string;
  shape: ArgShape;
  /** Every substitution only spreads `?` placeholders: usually safe. */
  placeholdersOnly: boolean;
  text: string;
}

const SQL_CALLS = new Set([
  "prepare",
  "exec",
  "run",
  "all",
  "get",
  "query",
  "raw",
]);
const SQL_WORD =
  /\b(SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|PRAGMA|WITH|REPLACE)\b/;
const PLACEHOLDER = /["'`]\?["'`]|placeholders?|\?,|qs\b|marks\b/i;

function substitutions(node: ts.Expression): ts.Expression[] {
  if (ts.isTemplateExpression(node))
    return node.templateSpans.map((s) => s.expression);
  if (
    ts.isBinaryExpression(node) &&
    node.operatorToken.kind === ts.SyntaxKind.PlusToken
  )
    return [...substitutions(node.left), ...substitutions(node.right)];
  if (ts.isParenthesizedExpression(node)) return substitutions(node.expression);
  if (ts.isStringLiteralLike(node)) return [];
  return [node];
}

/** SQL whose text is built with ${…} or +, rather than bound parameters. */
export function sqlConcat(files: SourceFile[]): SqlBuild[] {
  const out: SqlBuild[] = [];
  for (const file of files) {
    if (!isSource(file.path)) continue;
    const sf = parse(file);
    walk(sf, (node) => {
      if (!ts.isCallExpression(node)) return;
      const name = calleeName(node);
      const first = node.arguments[0];
      if (!name || !SQL_CALLS.has(name) || !first) return;
      if (!ts.isPropertyAccessExpression(node.expression)) return;
      const shape = argShape(first);
      if (shape === "literal" || shape === "variable") return;
      const text = stringText(first);
      if (!SQL_WORD.test(text)) return;
      const subs = substitutions(first);
      out.push({
        where: `${file.path}:${lineOf(sf, node.getStart(sf))}`,
        call: name,
        shape,
        placeholdersOnly:
          subs.length > 0 && subs.every((s) => PLACEHOLDER.test(s.getText(sf))),
        text: snippet(text),
      });
    });
  }
  return out.sort((a, b) => a.where.localeCompare(b.where));
}

export interface RouteInfo {
  path: string;
  methods: string[];
  /** Names imported from lib/security, e.g. requireLocalTrust. */
  guards: string[];
}

export interface RouteGuards {
  total: number;
  /** Reached without a device token: each must check for itself. */
  public: RouteInfo[];
  /** State-changing handlers that import no guard from lib/security, by area. */
  unguardedWrites: Record<string, string[]>;
  guarded: RouteInfo[];
}

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];
const WRITES = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** The URL a Next.js route file serves: app/api/x/[id]/route.ts -> /api/x/[id]. */
export function routePath(file: string): string {
  return (
    "/" +
    file
      .replace(/^app\//, "")
      .replace(/\/route\.(ts|tsx|js|mjs)$/, "")
      .split("/")
      .filter((s) => !/^\(.*\)$/.test(s))
      .join("/")
  );
}

/**
 * Every API route, the security guards it imports, and whether it is public.
 * Every route passes server.ts's device-token gate unless public, so a
 * public route, or a write with no extra guard, is what the audit reads.
 */
export function routeGuards(
  files: SourceFile[],
  isPublic: (url: string) => boolean
): RouteGuards {
  const result: RouteGuards = {
    total: 0,
    public: [],
    unguardedWrites: {},
    guarded: [],
  };
  for (const file of files) {
    if (!/^app\/api\/.*\/route\.(ts|tsx|js|mjs)$/.test(file.path)) continue;
    const sf = parse(file);
    const methods = new Set<string>();
    const guards = new Set<string>();
    for (const stmt of sf.statements) {
      const exported = ts.canHaveModifiers(stmt)
        ? ts
            .getModifiers(stmt)
            ?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
        : false;
      if (exported && ts.isFunctionDeclaration(stmt) && stmt.name)
        methods.add(stmt.name.text);
      if (exported && ts.isVariableStatement(stmt))
        for (const d of stmt.declarationList.declarations)
          if (ts.isIdentifier(d.name)) methods.add(d.name.text);
      if (
        ts.isExportDeclaration(stmt) &&
        stmt.exportClause &&
        ts.isNamedExports(stmt.exportClause)
      )
        for (const e of stmt.exportClause.elements) methods.add(e.name.text);
      if (
        ts.isImportDeclaration(stmt) &&
        ts.isStringLiteral(stmt.moduleSpecifier) &&
        /lib\/security\//.test(stmt.moduleSpecifier.text)
      ) {
        const named = stmt.importClause?.namedBindings;
        if (named && ts.isNamedImports(named))
          for (const el of named.elements) guards.add(el.name.text);
      }
    }
    const info: RouteInfo = {
      path: routePath(file.path),
      methods: METHODS.filter((m) => methods.has(m)),
      guards: [...guards].sort(),
    };
    if (info.methods.length === 0) continue;
    result.total++;
    // Dynamic segments stand in as a plain word for the public check.
    if (isPublic(info.path.replace(/\[[^\]]+\]/g, "x")))
      result.public.push(info);
    else if (info.guards.length) result.guarded.push(info);
    else {
      const writes = info.methods.filter((m) => WRITES.has(m));
      if (writes.length) {
        const area = info.path.split("/")[2] ?? "";
        (result.unguardedWrites[area] ??= []).push(
          `${writes.join(",")} ${info.path}`
        );
      }
    }
  }
  return result;
}

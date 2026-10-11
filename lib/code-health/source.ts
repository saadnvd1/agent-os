/**
 * The code-health pre-pass reads the repo as a list of {path, text}: the
 * collectors are pure functions of it, so tests feed them fixtures.
 */

import ts from "typescript";

export interface SourceFile {
  /** Repo-relative, forward slashes. */
  path: string;
  text: string;
}

const CODE = /\.(ts|tsx|mts|cts|js|mjs|cjs|jsx)$/;
const TEST = /(\.test\.|\.spec\.|(^|\/)__tests__\/|(^|\/)vitest\.setup\.)/;
// Generated, vendored or built: measured by other means or not ours.
const NOT_OURS =
  /(^|\/)(node_modules|\.next[^/]*|dist|out|coverage|public|src-tauri)\/|\.min\.js$|(^|\/)next-env\.d\.ts$/;

export const isCode = (p: string) => CODE.test(p) && !NOT_OURS.test(p);
export const isTest = (p: string) => TEST.test(p);
export const isSource = (p: string) => isCode(p) && !isTest(p);

export const lineCount = (text: string) =>
  text.length === 0
    ? 0
    : text.split("\n").length - (text.endsWith("\n") ? 1 : 0);

export function parse(file: SourceFile): ts.SourceFile {
  const kind = file.path.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  return ts.createSourceFile(
    file.path,
    file.text,
    ts.ScriptTarget.Latest,
    true,
    kind
  );
}

export const lineOf = (sf: ts.SourceFile, pos: number) =>
  sf.getLineAndCharacterOfPosition(pos).line + 1;

export function walk(node: ts.Node, visit: (n: ts.Node) => void) {
  visit(node);
  node.forEachChild((child) => walk(child, visit));
}

/** Source text, cut to one short line for a summary. */
export function snippet(text: string, max = 120): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/** A string argument's shape: what decides whether it can carry injection. */
export type ArgShape = "literal" | "interpolated" | "concatenated" | "variable";

export function argShape(node: ts.Expression): ArgShape {
  if (
    ts.isStringLiteral(node) ||
    ts.isNoSubstitutionTemplateLiteral(node) ||
    ts.isNumericLiteral(node)
  )
    return "literal";
  if (ts.isTemplateExpression(node)) return "interpolated";
  if (
    ts.isBinaryExpression(node) &&
    node.operatorToken.kind === ts.SyntaxKind.PlusToken
  )
    return argShape(node.left) === "literal" &&
      argShape(node.right) === "literal"
      ? "literal"
      : "concatenated";
  if (ts.isParenthesizedExpression(node)) return argShape(node.expression);
  return "variable";
}

const expr = (node: ts.Node) => "${" + snippet(node.getText(), 40) + "}";

/** The text a string-ish expression would carry, substitutions shown by their source. */
export function stringText(node: ts.Expression): string {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
    return node.text;
  if (ts.isTemplateExpression(node))
    return (
      node.head.text +
      node.templateSpans
        .map((s) => expr(s.expression) + s.literal.text)
        .join("")
    );
  if (
    ts.isBinaryExpression(node) &&
    node.operatorToken.kind === ts.SyntaxKind.PlusToken
  )
    return stringText(node.left) + stringText(node.right);
  if (ts.isParenthesizedExpression(node)) return stringText(node.expression);
  return expr(node);
}

/** The called name: `exec` for exec(), cp.exec() and child_process.exec(). */
export function calleeName(call: ts.CallExpression): string | null {
  const c = call.expression;
  if (ts.isIdentifier(c)) return c.text;
  if (ts.isPropertyAccessExpression(c)) return c.name.text;
  return null;
}

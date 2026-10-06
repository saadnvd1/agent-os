// A fence longer than any backtick run inside, so the code can't close it.
export function fenceFor(code: string): string {
  const longest = Math.max(
    0,
    ...(code.match(/`+/g) ?? []).map((r) => r.length)
  );
  return "`".repeat(Math.max(3, longest + 1));
}

export function fenced(code: string, language = ""): string {
  const fence = fenceFor(code);
  return `${fence}${language}\n${code}\n${fence}`;
}

export function codeSpan(code: string): string {
  const longest = Math.max(
    0,
    ...(code.match(/`+/g) ?? []).map((r) => r.length)
  );
  const ticks = "`".repeat(longest + 1);
  const pad = code.startsWith("`") || code.endsWith("`") ? " " : "";
  return `${ticks}${pad}${code}${pad}${ticks}`;
}

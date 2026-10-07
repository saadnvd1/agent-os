// The web's code colours: Prism's One Dark and One Light (components/Chat/Code.tsx).
type Colors = Record<string, string>;

const group = (color: string, ...types: string[]): Colors =>
  Object.fromEntries(types.map((t) => [t, color]));

export const ONE_DARK: Colors = {
  ...group("hsl(220, 10%, 40%)", "comment", "prolog", "cdata"),
  ...group("hsl(220, 14%, 71%)", "doctype", "punctuation", "entity"),
  ...group(
    "hsl(29, 54%, 61%)",
    "attr-name",
    "class-name",
    "boolean",
    "constant",
    "number",
    "atrule"
  ),
  ...group("hsl(286, 60%, 67%)", "keyword"),
  ...group(
    "hsl(355, 65%, 65%)",
    "property",
    "tag",
    "symbol",
    "deleted",
    "important"
  ),
  ...group(
    "hsl(95, 38%, 62%)",
    "selector",
    "string",
    "char",
    "builtin",
    "inserted",
    "regex",
    "attr-value"
  ),
  ...group("hsl(207, 82%, 66%)", "variable", "operator", "function"),
  ...group("hsl(187, 47%, 55%)", "url"),
  base: "hsl(220, 14%, 71%)",
};

export const ONE_LIGHT: Colors = {
  ...group("hsl(230, 4%, 64%)", "comment", "prolog", "cdata"),
  ...group("hsl(230, 8%, 24%)", "doctype", "punctuation", "entity"),
  ...group(
    "hsl(35, 99%, 36%)",
    "attr-name",
    "class-name",
    "boolean",
    "constant",
    "number",
    "atrule"
  ),
  ...group("hsl(301, 63%, 40%)", "keyword"),
  ...group(
    "hsl(5, 74%, 59%)",
    "property",
    "tag",
    "symbol",
    "deleted",
    "important"
  ),
  ...group(
    "hsl(119, 34%, 47%)",
    "selector",
    "string",
    "char",
    "builtin",
    "inserted",
    "regex",
    "attr-value"
  ),
  ...group("hsl(221, 87%, 60%)", "variable", "operator", "function"),
  ...group("hsl(198, 99%, 37%)", "url"),
  base: "hsl(230, 8%, 24%)",
};

// The innermost token type that has a colour wins, as in CSS.
export function tokenColor(types: string[], colors: Colors): string {
  for (let i = types.length - 1; i >= 0; i--) {
    const c = colors[types[i]];
    if (c) return c;
  }
  return colors.base;
}

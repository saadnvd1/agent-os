// Raw HTML in a reply is shown as its text, never rendered or run: the
// tags go, what they wrapped stays. Only real HTML element names count as
// tags, so prose like Array<string> or <Component> keeps its text. mdast
// hands inline HTML over one tag at a time (`<span …>`, text, `</span>`).
const ELEMENTS = [
  "a",
  "abbr",
  "b",
  "blockquote",
  "br",
  "center",
  "code",
  "del",
  "details",
  "div",
  "em",
  "font",
  "h[1-6]",
  "hr",
  "i",
  "iframe",
  "img",
  "ins",
  "kbd",
  "li",
  "mark",
  "ol",
  "p",
  "pre",
  "s",
  "script",
  "section",
  "small",
  "span",
  "strike",
  "strong",
  "style",
  "sub",
  "summary",
  "sup",
  "table",
  "tbody",
  "td",
  "th",
  "thead",
  "tr",
  "u",
  "ul",
].join("|");
// Quoted attribute values may hold ">"; they're skipped whole. Nothing in
// a tag may cross a "<", so a hostile reply full of unclosed tags is still
// stripped in linear time.
const TAG = new RegExp(
  `</?(?:${ELEMENTS})(?=[\\s/>])(?:"[^"<]*"|'[^'<]*'|[^'"<>])*>|<!--[\\s\\S]*?(?:-->|$)`,
  "gi"
);

export function htmlText(html: string): string {
  return html.replace(TAG, "");
}

// A block of HTML: its text, or nothing when it was only tags.
export function htmlBlockText(html: string): string | null {
  const text = htmlText(html).trim();
  return text ? text : null;
}

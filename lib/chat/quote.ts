// A selection from a reply, as a markdown blockquote with a blank line
// after, to write under. Blank lines inside stay part of the quote.
export function quoteMarkdown(selection: string): string {
  const lines = selection
    .replace(/\r\n?/g, "\n")
    .replace(/^\n+|\s+$/g, "")
    .split("\n");
  if (lines.length === 1 && !lines[0].trim()) return "";
  return `${lines.map((l) => (l.trim() ? `> ${l}` : ">")).join("\n")}\n\n`;
}

// Markdown as editor paragraphs, one per line (the composer writes each
// paragraph as a line), to put in at the caret.
export function markdownParagraphs(
  md: string
): { type: "paragraph"; content?: { type: "text"; text: string }[] }[] {
  if (!md) return [];
  return md
    .split("\n")
    .map((line) =>
      line
        ? { type: "paragraph", content: [{ type: "text", text: line }] }
        : { type: "paragraph" }
    );
}

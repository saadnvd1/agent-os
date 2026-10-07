// Raw HTML in a reply is shown as its text, never rendered or run: the
// tags go, what they wrapped stays. mdast hands inline HTML over one tag
// at a time (`<span …>`, text, `</span>`), so stripping each node is enough.
const TAG = /<\/?[A-Za-z][^>]*>|<!--[\s\S]*?(-->|$)/g;

export function htmlText(html: string): string {
  return html.replace(TAG, "");
}

export interface HistoryFill {
  hasMore: boolean;
  loading: boolean;
  scrollHeight: number;
  clientHeight: number;
}

// An older page can fold into a few collapsed rows, leaving a list too short
// to scroll, so no scroll event would ever ask for the next page. Keep about
// one extra screen of content above the fold.
export function needsMoreHistory(f: HistoryFill): boolean {
  if (!f.hasMore || f.loading || f.clientHeight <= 0) return false;
  return f.scrollHeight <= f.clientHeight * 2;
}

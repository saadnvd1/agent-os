// Claude Code's working line, whatever word it picks: "✻ Composing… (4m 0s ·
// ↓ 23.5k tokens)". It sits above the input box and status line, so it can be
// several lines up from the bottom.
export const WORKING_LINE = /^\s*\S\s+[A-Z][a-z]+(?:ing)?…\s+\(\d+[smh]?\b/m;

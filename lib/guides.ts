/** Where the user guides (docs/guides/*.md) are read on the web. */
export const GUIDES =
  "https://github.com/saadnvd1/agent-os/blob/main/docs/guides";

export const guideUrl = (g: { file: string; anchor?: string }) =>
  `${GUIDES}/${g.file}.md${g.anchor ? `#${g.anchor}` : ""}`;

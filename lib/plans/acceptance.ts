// A plan's optional "## Acceptance" section: a checklist of observable
// outcomes, parsed like the "## Pieces" block.

const MAX_ITEMS = 12;
const MAX_LEN = 240;

export function parseAcceptance(plan: string | null | undefined): string[] {
  if (!plan) return [];
  const lines = plan.split("\n");
  const start = lines.findIndex((l) => /^##\s+Acceptance\s*$/i.test(l.trim()));
  if (start < 0) return [];
  const items: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^#{1,6}\s/.test(line)) break;
    const m = /^\s*[-*]\s+\[[ xX]\]\s+(.+?)\s*$/.exec(line);
    if (!m) continue;
    items.push(m[1].slice(0, MAX_LEN));
    if (items.length >= MAX_ITEMS) break;
  }
  return items;
}

export const ACCEPTANCE_PROMPT = `Also end the plan with an \`## Acceptance\` section: 3 to 8 checklist lines (\`- [ ] ...\`), each one outcome a test, a CI check or the review could show is true. They become the progress report's completion estimate.`;

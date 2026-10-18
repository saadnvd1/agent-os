// Folders the test suite makes in the OS temp folder are named aos-… or
// agent-os-…. The few of those that AgentOS itself makes while running are
// listed here so the sweep never takes them.
const PRODUCT_PREFIXES = [
  "aos-snap-",
  "aos-review-",
  "aos-rebase-",
  "aos-bench-",
  "aos-disk-dry-",
  "agent-os-screenshots",
];

export const isTestTempName = (name: string) =>
  (name.startsWith("aos-") || name.startsWith("agent-os-")) &&
  !PRODUCT_PREFIXES.some((p) => name.startsWith(p));

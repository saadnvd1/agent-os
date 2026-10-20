// What the sweep may take from the OS temp folder as a test run's leftovers.
// Every folder a test makes with tempDir() lives inside a run root named
// RUN_PREFIX…, so the sweep matches that one prefix and a new test needs no
// list edit. Names AgentOS makes itself (aos-snap-, aos-review-…) never
// start with it.

/** Short: a Unix socket path is capped at 104 bytes on macOS. */
export const RUN_PREFIX = "aos-t-";

// Names only the test suite created, left directly in the OS temp folder by
// runs from before every test got its own root. Frozen: nothing new belongs
// here. Names server code also creates (agentos-db-, agentos-img-…) are not
// listed, since a live server could own them.
export const LEGACY_TEST_TEMP_PREFIXES: readonly string[] = [
  "agent-os-test-",
  "agent-os-home-",
  "agent-os-limits-",
  "agent-os-git-",
  "agent-os-session-logs-",
  "agent-os-kept-",
  "aos-done-repo-",
  "aos-orch-repo-",
  "aos-armed-repo-",
  "aos-orch-ext-repo-",
  "aos-orch-external-",
  "aos-quick-repo-",
  "aos-config-",
  "agentos-link-",
];

export const isTestTempName = (name: string) =>
  name.startsWith(RUN_PREFIX) ||
  LEGACY_TEST_TEMP_PREFIXES.some((p) => name.startsWith(p));

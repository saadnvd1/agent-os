// What a person reads when a chat's worker can't start. The raw error (a
// socket ENOENT, usually) stays in the server log.
export function startFailureMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  if (!/^The chat worker didn't start/.test(raw)) return raw;
  const reason = /ENOENT|ECONNREFUSED/.test(raw)
    ? "it stopped while starting"
    : raw
        .replace(/^The chat worker didn't start:?\s*/, "")
        .split("\n")[0]
        .slice(0, 120) || "it didn't answer";
  return `Couldn't start the agent: ${reason}`;
}

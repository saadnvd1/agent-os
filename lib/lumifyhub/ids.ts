// LumifyHub's boards, lists, cards and pages are keyed by UUID.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isLumifyHubId(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

// Throws inside `respond`, which answers 400.
export function lumifyHubId(value: unknown, what = "id"): string {
  if (!isLumifyHubId(value)) throw new Error(`Invalid LumifyHub ${what}`);
  return value;
}

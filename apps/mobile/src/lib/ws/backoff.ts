// 1s, 2s, 4s… capped at 30s, like the web client's status stream.
export function backoffMs(attempt: number, cap = 30000): number {
  return Math.min(cap, 1000 * 2 ** Math.max(0, attempt));
}

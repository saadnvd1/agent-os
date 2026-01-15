/**
 * Store for pending initial prompts to be sent when terminal becomes ready
 * Uses a simple Map keyed by sessionId
 */

const pendingPrompts = new Map<string, string>();

export function setPendingPrompt(sessionId: string, prompt: string): void {
  if (prompt.trim()) {
    pendingPrompts.set(sessionId, prompt.trim());
  }
}

export function getPendingPrompt(sessionId: string): string | null {
  return pendingPrompts.get(sessionId) || null;
}

export function clearPendingPrompt(sessionId: string): void {
  pendingPrompts.delete(sessionId);
}

export function hasPendingPrompt(sessionId: string): boolean {
  return pendingPrompts.has(sessionId);
}

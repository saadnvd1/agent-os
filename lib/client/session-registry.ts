/**
 * Client-side registry for preserving terminal state across navigation
 * Stores scroll positions and other ephemeral state that should persist
 * when switching between tabs/sessions.
 */

interface TerminalState {
  scrollTop: number;
  scrollHeight: number;
  lastActivity: number;
  cursorY: number;
}

interface SessionEntry {
  tabId: string;
  sessionId?: string;
  attachedTmux?: string;
  terminalState?: TerminalState;
}

class SessionRegistry {
  private sessions: Map<string, SessionEntry> = new Map();

  /**
   * Generate a unique key for a pane+tab combination
   */
  private getKey(paneId: string, tabId: string): string {
    return `${paneId}:${tabId}`;
  }

  /**
   * Register or update a session entry
   */
  register(
    paneId: string,
    tabId: string,
    data: Partial<Omit<SessionEntry, "tabId">>
  ): void {
    const key = this.getKey(paneId, tabId);
    const existing = this.sessions.get(key);

    this.sessions.set(key, {
      tabId,
      ...existing,
      ...data,
    });
  }

  /**
   * Get session entry
   */
  get(paneId: string, tabId: string): SessionEntry | undefined {
    return this.sessions.get(this.getKey(paneId, tabId));
  }

  /**
   * Save terminal state (scroll position, cursor, etc.)
   */
  saveTerminalState(
    paneId: string,
    tabId: string,
    state: TerminalState
  ): void {
    const key = this.getKey(paneId, tabId);
    const existing = this.sessions.get(key);

    this.sessions.set(key, {
      tabId,
      ...existing,
      terminalState: state,
    });
  }

  /**
   * Get saved terminal state
   */
  getTerminalState(paneId: string, tabId: string): TerminalState | undefined {
    return this.sessions.get(this.getKey(paneId, tabId))?.terminalState;
  }

  /**
   * Remove session entry
   */
  remove(paneId: string, tabId: string): void {
    this.sessions.delete(this.getKey(paneId, tabId));
  }

  /**
   * Clear all entries for a pane
   */
  clearPane(paneId: string): void {
    for (const key of this.sessions.keys()) {
      if (key.startsWith(`${paneId}:`)) {
        this.sessions.delete(key);
      }
    }
  }

  /**
   * Clear all entries
   */
  clear(): void {
    this.sessions.clear();
  }

  /**
   * Get count of active sessions
   */
  get size(): number {
    return this.sessions.size;
  }
}

// Singleton instance
export const sessionRegistry = new SessionRegistry();

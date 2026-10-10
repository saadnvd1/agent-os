import { describe, expect, it } from "vitest";
import {
  SessionUrlSync,
  hrefWithSession,
  locateSession,
  pairLocation,
  safeNextPath,
  sessionIdFromHref,
  sessionLink,
} from "./session-url";
import type { PaneState } from "./panes";

// A browser's history, enough of it: entries, a cursor, back and forward.
function browser(start: string) {
  const entries = [start];
  let at = 0;
  return {
    entries,
    get at() {
      return at;
    },
    env: {
      href: () => `http://host${entries[at]}`,
      push: (href: string) => {
        entries.splice(at + 1, Infinity, href);
        at++;
      },
      replace: (href: string) => {
        entries[at] = href;
      },
    },
    back: () => at--,
    forward: () => at++,
    current: () => entries[at],
  };
}

// The page: a list of sessions and a focused one, which open() changes the
// way attaching a session does.
function page(start: string, listed = ["a", "b", "c"]) {
  const b = browser(start);
  const notFound: string[] = [];
  let unlisted: string[] = [];
  const sync: SessionUrlSync = new SessionUrlSync(b.env, {
    isKnown: (id) => listed.includes(id),
    open: (id) => sync.focusChanged(id),
    openUnlisted: async (id) => {
      if (!unlisted.includes(id)) return false;
      listed.push(id);
      sync.focusChanged(id);
      return true;
    },
    notFound: (id) => notFound.push(id),
  });
  return {
    b,
    sync,
    notFound,
    listed,
    appearLater: (id: string) => (unlisted = [...unlisted, id]),
    // The user picking a session in the sidebar.
    pick: (id: string | null) => sync.focusChanged(id),
    async back() {
      b.back();
      await sync.popstate();
    },
    async forward() {
      b.forward();
      await sync.popstate();
    },
  };
}

describe("address helpers", () => {
  it("reads and writes the session param, keeping everything else", () => {
    expect(sessionIdFromHref("http://h/?session=abc-123")).toBe("abc-123");
    expect(sessionIdFromHref("/?x=1")).toBeNull();
    expect(sessionIdFromHref("/?session=<script>")).toBeNull();
    expect(hrefWithSession("/?x=1#h", "s1")).toBe("/?x=1&session=s1#h");
    expect(hrefWithSession("/?session=s1&x=1", null)).toBe("/?x=1");
    expect(sessionLink("https://h:3011", "s1")).toBe(
      "https://h:3011/?session=s1"
    );
  });

  it("keeps only same-site paths to come back to after pairing", () => {
    expect(safeNextPath("/?session=abc")).toBe("/?session=abc");
    for (const bad of [
      null,
      "",
      "/",
      "//evil.example/?session=a",
      "/\\evil.example",
      "https://evil.example/",
      "javascript:alert(1)",
      "/pair?next=/",
    ]) {
      expect(safeNextPath(bad)).toBeNull();
    }
    expect(pairLocation("/?session=abc")).toBe(
      "/pair?next=%2F%3Fsession%3Dabc"
    );
    expect(pairLocation("/")).toBe("/pair");
    expect(pairLocation("//evil.example")).toBe("/pair");
  });

  it("finds where a session already shows, active tabs first", () => {
    const state: PaneState = {
      layout: {
        type: "split",
        direction: "horizontal",
        sizes: [50, 50],
        children: [
          { type: "leaf", paneId: "p1" },
          { type: "leaf", paneId: "p2" },
        ],
      },
      focusedPaneId: "p1",
      panes: {
        p1: {
          activeTabId: "t1",
          tabs: [
            { id: "t1", sessionId: "a", attachedTmux: null },
            { id: "t2", sessionId: "b", attachedTmux: null },
          ],
        },
        p2: {
          activeTabId: "t3",
          tabs: [{ id: "t3", sessionId: "b", attachedTmux: null }],
        },
      },
    };
    expect(locateSession(state, "b")).toEqual({ paneId: "p2", tabId: "t3" });
    expect(locateSession(state, "b", ["p1"])).toEqual({
      paneId: "p1",
      tabId: "t2",
    });
    expect(locateSession(state, "z")).toBeNull();
  });
});

describe("SessionUrlSync", () => {
  it("opens the session the address names on load, over the restored one", async () => {
    const p = page("/?session=b");
    p.pick("a"); // the saved layout, restored before the list loads
    await p.sync.start();
    expect(p.b.current()).toBe("/?session=b");
    expect(p.b.entries).toHaveLength(1);
  });

  it("writes the restored session into a bare address without a new entry", async () => {
    const p = page("/");
    p.pick("a");
    await p.sync.start();
    expect(p.b.entries).toEqual(["/?session=a"]);
  });

  it("pushes an entry for each switch, and back/forward move between them", async () => {
    const p = page("/");
    p.pick("a");
    await p.sync.start();
    p.pick("b");
    p.pick("c");
    expect(p.b.entries).toEqual(["/?session=a", "/?session=b", "/?session=c"]);

    await p.back();
    expect(p.b.current()).toBe("/?session=b");
    await p.back();
    expect(p.b.current()).toBe("/?session=a");
    await p.forward();
    expect(p.b.current()).toBe("/?session=b");
    // Opening from history adds no entries of its own.
    expect(p.b.entries).toHaveLength(3);
  });

  it("replaces when the session was archived out from under the page", async () => {
    const p = page("/");
    p.pick("a");
    await p.sync.start();
    p.listed.splice(p.listed.indexOf("a"), 1);
    p.pick(null);
    expect(p.b.entries).toEqual(["/"]);
  });

  it("falls back home for an unknown id, without a dead entry", async () => {
    const p = page("/?session=gone&x=1");
    p.pick("a");
    await p.sync.start();
    expect(p.notFound).toEqual(["gone"]);
    expect(p.b.entries).toEqual(["/?session=a&x=1"]);
  });

  it("asks again for a session made a moment ago", async () => {
    const p = page("/?session=new");
    p.appearLater("new");
    await p.sync.start();
    expect(p.notFound).toEqual([]);
    expect(p.b.current()).toBe("/?session=new");
  });

  it("an entry that no longer opens says what is shown instead", async () => {
    const p = page("/");
    p.pick("a");
    await p.sync.start();
    p.pick("b");
    p.listed.splice(p.listed.indexOf("a"), 1);
    await p.back();
    expect(p.notFound).toEqual(["a"]);
    expect(p.b.current()).toBe("/?session=b");
  });

  it("ignores the page's focus while an opened session is on its way", async () => {
    let now = 0;
    const b = browser("/?session=b");
    let opened: string | null = null;
    const sync = new SessionUrlSync(
      b.env,
      {
        isKnown: () => true,
        open: (id) => (opened = id),
        openUnlisted: async () => false,
        notFound: () => {},
      },
      () => now
    );
    sync.focusChanged("a");
    await sync.start();
    expect(opened).toBe("b");
    sync.focusChanged("a"); // a re-render before the attach lands
    expect(b.current()).toBe("/?session=b");
    // An open that never lands stops holding the address.
    now = 10_000;
    sync.focusChanged("a");
    expect(b.current()).toBe("/?session=a");
  });
});

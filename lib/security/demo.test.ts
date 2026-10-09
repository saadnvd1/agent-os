import fs from "fs";
import os from "os";
import path from "path";
import { EventEmitter } from "events";
import { describe, expect, it, vi } from "vitest";
import type { IncomingMessage, ServerResponse } from "http";
import type { Duplex } from "stream";
import {
  STATIC_SIBLINGS,
  assertDemoSandbox,
  DEMO_SOCKETS_PER_CLIENT,
  gateDemoRequest,
  refuseDemoUpgrade,
  DEMO_BUSY_REASON,
  admitDemoSocket,
  demoClientKey,
  socketLimiter,
  demoAllows,
  demoAllowsUpgrade,
  demoMode,
} from "./demo";

const HOME = "/srv/demo/home/alex";
const allows = (method: string, url: string) =>
  demoAllows({ method, url }, HOME);

describe("demo mode", () => {
  it("is on only for AGENTOS_DEMO=1", () => {
    expect(demoMode({ AGENTOS_DEMO: "1" })).toBe(true);
    expect(demoMode({ AGENTOS_DEMO: "true" })).toBe(false);
    expect(demoMode({})).toBe(false);
  });
});

describe("demo gate: refused", () => {
  it("terminals: no /ws/terminal, nor any socket off the list", () => {
    expect(demoAllowsUpgrade("/ws/terminal", true)).toBe(false);
    expect(demoAllowsUpgrade("/ws/terminal", false)).toBe(false);
    expect(demoAllowsUpgrade("/ws/anything", true)).toBe(false);
    expect(demoAllowsUpgrade(null, true)).toBe(false);
    expect(demoAllowsUpgrade("/_next/webpack-hmr", false)).toBe(false);
  });

  it.each([
    ["exec", "/api/exec"],
    ["send-keys", "/api/sessions/abc/send-keys"],
    ["git commit", "/api/git/commit"],
    ["git push", "/api/git/push"],
    ["git stage", "/api/git/stage"],
    ["git unstage", "/api/git/unstage"],
    ["git discard", "/api/git/discard"],
    ["git check", "/api/git/check"],
    ["opening a PR", "/api/git/pr"],
    ["tmux kill-all", "/api/tmux/kill-all"],
    ["tmux rename", "/api/tmux/rename"],
    ["file write", "/api/files/content"],
    ["file upload", "/api/files/upload-temp"],
    ["new session", "/api/sessions"],
    ["fork", "/api/sessions/abc/fork"],
    ["summarize", "/api/sessions/abc/summarize"],
    ["init script", "/api/sessions/init-script"],
    ["new task", "/api/tasks"],
    ["merge", "/api/tasks/abc/merge"],
    ["dev server", "/api/dev-servers"],
    ["dev server restart", "/api/dev-servers/abc/restart"],
    ["clone", "/api/projects/clone"],
    ["project init", "/api/projects/init"],
    ["bus spawn", "/api/bus/spawn"],
    ["bus send", "/api/bus/send"],
    ["orchestrate spawn", "/api/orchestrate/spawn"],
    ["schedule run", "/api/schedules/abc/run"],
    ["host test", "/api/hosts/abc/test"],
    ["card run", "/api/lumifyhub/cards/abc/run"],
    ["chat message", "/api/sessions/abc/messages"],
  ])("%s (POST %s)", (_, url) => {
    expect(allows("POST", url)).toBe(false);
  });

  it("changes to things the reads can see", () => {
    for (const method of ["PUT", "PATCH", "DELETE"]) {
      expect(allows(method, "/api/sessions/abc")).toBe(false);
      expect(allows(method, "/api/projects/abc")).toBe(false);
      expect(allows(method, "/api/files/content?path=~/code/a")).toBe(false);
    }
  });

  it("routes not on the list, even reads (fail closed)", () => {
    expect(allows("GET", "/api/brand-new-route")).toBe(false);
    // Runs every agent CLI it finds, to read its version.
    expect(allows("GET", "/api/agents/status")).toBe(false);
    expect(allows("GET", "/api/hosts")).toBe(false);
    expect(allows("GET", "/api/projects/browse")).toBe(false);
    expect(allows("GET", "/api/lumifyhub/callback")).toBe(false);
    expect(allows("GET", "/api/sessions/abc/claude-session")).toBe(false);
    expect(allows("GET", "/api/sessions/done-idle")).toBe(false);
    expect(allows("GET", "/api/projects/detect")).toBe(false);
  });

  it("Next's endpoints other than static files (they reach the API inside)", () => {
    expect(allows("GET", "/_next/image?url=%2Fapi%2Fsessions&w=64&q=75")).toBe(
      false
    );
    expect(allows("GET", "/_next/%69mage?url=/api/sessions")).toBe(false);
    expect(allows("GET", "/__nextjs_original-stack-frame")).toBe(false);
    expect(allows("GET", "/_next/static/chunks/main.js")).toBe(true);
  });

  it("ids that start with -, which a command line could read as an option", () => {
    expect(allows("GET", "/api/git/history/-p?path=~/code/a")).toBe(false);
    expect(
      allows("GET", "/api/git/history/--output=x/diff?path=~/code/a")
    ).toBe(false);
    expect(allows("GET", "/api/sessions/-abc")).toBe(false);
    expect(allows("GET", "/api/git/history/abc1234?path=~/code/a")).toBe(true);
  });

  it("posts to pages (server actions)", () => {
    expect(allows("POST", "/")).toBe(false);
    expect(allows("POST", "/sessions/abc")).toBe(false);
  });

  it("relative paths, which routes resolve against the server's folder", () => {
    expect(allows("GET", "/api/files/content?path=.env")).toBe(false);
    expect(allows("GET", "/api/files?path=.")).toBe(false);
    expect(allows("GET", "/api/git/status?path=lib")).toBe(false);
    expect(allows("GET", "/api/files/content?path=~-other/x")).toBe(false);
    expect(allows("GET", "/api/git/file-content?file=a.ts")).toBe(false);
  });

  it("paths a shell or an option parser could read as code", () => {
    for (const bad of [
      '~/code/a"$(id)"',
      "~/code/a`id`",
      "~/code/a;id",
      "~/code/a b",
      "-x",
    ])
      expect(allows("GET", `/api/git/pr?path=${encodeURIComponent(bad)}`)).toBe(
        false
      );
    for (const file of ["$(id)", '"x', "-p", "a;b", "a b"])
      expect(
        allows(
          "GET",
          `/api/git/file-content?path=~/code/a&file=${encodeURIComponent(file)}`
        )
      ).toBe(false);
  });

  it("a symlink in the home that points out of it", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "demo-gate-"));
    const home = path.join(root, "home");
    fs.mkdirSync(path.join(home, "code", "a"), { recursive: true });
    fs.symlinkSync("/", path.join(home, "out"));
    fs.symlinkSync("/etc", path.join(home, "code", "a", "etc"));
    const ok = (url: string) => demoAllows({ method: "GET", url }, home);
    expect(ok("/api/files?path=~/code/a")).toBe(true);
    expect(ok("/api/files?path=~/out")).toBe(false);
    expect(ok("/api/files?path=~/out/etc")).toBe(false);
    expect(ok("/api/git/file-content?path=~/code/a&file=etc/hosts")).toBe(
      false
    );
    expect(ok("/api/git/file-content?path=~/code/a&file=src/a.ts")).toBe(true);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("reads outside the demo's home", () => {
    expect(allows("GET", "/api/files/content?path=/etc/passwd")).toBe(false);
    expect(allows("GET", "/api/files?path=/")).toBe(false);
    expect(allows("GET", "/api/files?path=~/../../etc")).toBe(false);
    expect(allows("GET", `/api/files?path=${HOME}-other`)).toBe(false);
    expect(allows("GET", "/api/files/image?path=%2Fetc%2Fhosts")).toBe(false);
    expect(
      allows("GET", "/api/git/file-content?path=~/code/a&file=../../../x")
    ).toBe(false);
    expect(allows("GET", "/api/git/status?path=~/code/a%00")).toBe(false);
    expect(allows("GET", "/api/code-search?query=x&path=/Users")).toBe(false);
    expect(
      allows("GET", "/api/git/multi-status?projectId=a&fallbackPath=/etc")
    ).toBe(false);
    expect(allows("GET", "/api/files/../exec")).toBe(false);
  });

  it("reads that would reach another machine or start an agent", () => {
    expect(allows("GET", "/api/files?path=~/code&hostId=box")).toBe(false);
    expect(allows("GET", "/api/git/pr?path=~/code/a&generate=true")).toBe(
      false
    );
  });
});

describe("demo gate: allowed", () => {
  it("everything a client app needs to connect and browse", () => {
    for (const url of [
      "/api/devices",
      "/api/devices/network",
      "/api/orchestrators",
      "/api/projects",
      "/api/sessions",
      "/api/sessions/status",
      "/api/tasks",
      "/api/workspaces",
      "/api/demo",
      "/api/sessions/6c1a585a-5a7b-4c3b-80e9-90f6fac0267b/preview",
    ])
      expect(allows("GET", url), url).toBe(true);
    expect(demoAllowsUpgrade("/ws/chat", false)).toBe(true);
    expect(demoAllowsUpgrade("/ws/status", false)).toBe(true);
  });

  it("the client's writes, each by its own method only", () => {
    expect(allows("POST", "/api/sessions/abc/pin")).toBe(true);
    expect(allows("POST", "/api/sessions/abc/done")).toBe(true);
    expect(allows("POST", "/api/workspaces/w1/orchestrator/asks/7")).toBe(true);
    expect(allows("DELETE", "/api/devices/d1")).toBe(true);
    expect(allows("PATCH", "/api/devices/d1")).toBe(false);
    expect(allows("PUT", "/api/devices/network")).toBe(false);
    expect(allows("DELETE", "/api/sessions/abc")).toBe(false);
    expect(allows("POST", "/api/workspaces/w1/orchestrator/pause")).toBe(false);
    expect(allows("POST", "/api/workspaces/w1/orchestrator")).toBe(false);
  });

  it("pages and their assets", () => {
    expect(allows("GET", "/")).toBe(true);
    expect(allows("GET", "/_next/static/chunks/main.js")).toBe(true);
    expect(allows("HEAD", "/")).toBe(true);
  });

  it("reads of the seeded sessions, chats, diffs and PRs", () => {
    expect(allows("GET", "/api/sessions")).toBe(true);
    expect(allows("GET", "/api/sessions/abc")).toBe(true);
    expect(allows("GET", "/api/sessions/abc/pr")).toBe(true);
    expect(allows("GET", "/api/git/status?path=~/code/storefront")).toBe(true);
    expect(
      allows("GET", `/api/git/file-content?path=${HOME}/code/a&file=src/a.ts`)
    ).toBe(true);
    expect(allows("GET", "/api/git/history/abc123/diff?path=~/code/a")).toBe(
      true
    );
    expect(allows("GET", "/api/git/pr?path=~/code/a")).toBe(true);
    expect(allows("GET", "/api/files?path=~/code&hostId=local")).toBe(true);
  });

  it("pairing, and marking a session seen", () => {
    expect(allows("POST", "/api/pair/start")).toBe(true);
    expect(allows("POST", "/api/pair/claim")).toBe(true);
    expect(allows("GET", "/api/pair/status")).toBe(true);
    expect(allows("POST", "/api/sessions/abc/seen")).toBe(true);
  });

  it("chat and status sockets; the dev reloader only in development", () => {
    expect(demoAllowsUpgrade("/ws/chat", false)).toBe(true);
    expect(demoAllowsUpgrade("/ws/status", false)).toBe(true);
    expect(demoAllowsUpgrade("/_next/webpack-hmr", true)).toBe(true);
    expect(demoAllowsUpgrade("/_next/hmr", true)).toBe(true);
    expect(demoAllowsUpgrade("/_next/hmr", false)).toBe(false);
  });
});

// Every write any route exports, found on disk: a new route is refused
// until someone puts it on the list on purpose.
describe("demo gate: every write route in app/api", () => {
  const api = path.resolve(__dirname, "../../app/api");
  const routes: { url: string; method: string }[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name === "route.ts") {
        const src = fs.readFileSync(full, "utf8");
        const url =
          "/api/" +
          path
            .relative(api, dir)
            .split(path.sep)
            .map((s) =>
              s.startsWith("[...") ? "a/b" : s.startsWith("[") ? "x1" : s
            )
            .join("/");
        for (const m of src.matchAll(
          /export (?:async )?(?:function|const) (POST|PUT|PATCH|DELETE)\b/g
        ))
          routes.push({ url, method: m[1] });
      }
    }
  };
  walk(api);
  const ALLOWED = new Set([
    "POST /api/pair/start",
    "POST /api/pair/claim",
    "POST /api/sessions/x1/seen",
    "POST /api/sessions/x1/pin",
    "POST /api/sessions/x1/done",
    "POST /api/workspaces/x1/orchestrator/asks/x1",
    "DELETE /api/devices/x1",
  ]);

  it("knows every static folder beside a dynamic one", () => {
    const found = new Set<string>();
    const scan = (dir: string) => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      const dirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);
      if (dirs.some((d) => d.startsWith("[")))
        dirs.filter((d) => !d.startsWith("[")).forEach((d) => found.add(d));
      dirs.forEach((d) => scan(path.join(dir, d)));
    };
    scan(api);
    for (const name of found) expect(STATIC_SIBLINGS).toContain(name);
  });

  it("finds the routes", () => {
    expect(routes.length).toBeGreaterThan(80);
  });

  it("refuses all of them but the database-only ones", () => {
    const let_through = routes
      .filter((r) => demoAllows(r, HOME))
      .map((r) => `${r.method} ${r.url}`);
    expect(new Set(let_through)).toEqual(ALLOWED);
  });
});

describe("assertDemoSandbox", () => {
  const env = (extra: Record<string, string>) => ({
    AGENTOS_DEMO_ROOT: "/srv/demo",
    DB_PATH: "/srv/demo/agent-os.db",
    ...extra,
  });

  it("passes when home and database are in the demo root", () => {
    expect(() => assertDemoSandbox(env({}), HOME)).not.toThrow();
  });

  it("refuses the machine's real home or database", () => {
    expect(() => assertDemoSandbox(env({}), "/home/someone")).toThrow();
    expect(() =>
      assertDemoSandbox(env({ DB_PATH: "/home/someone/agent-os.db" }), HOME)
    ).toThrow();
    expect(() =>
      assertDemoSandbox({ DB_PATH: "/srv/demo/a.db" }, HOME)
    ).toThrow();
    expect(() =>
      assertDemoSandbox(env({ AGENTOS_DEMO_ROOT: "/" }), HOME)
    ).toThrow();
    expect(() =>
      assertDemoSandbox(env({ DB_PATH: "/srv/demo-other/a.db" }), HOME)
    ).toThrow();
  });
});

describe("demo gate: answering", () => {
  const res = () => {
    const r = {
      statusCode: 200,
      headers: {} as Record<string, string>,
      body: "",
    };
    return Object.assign(r, {
      setHeader: (k: string, v: string) => (r.headers[k] = v),
      end: (b?: string) => (r.body = b ?? ""),
    });
  };

  it("answers a refused request 403 and stops it", () => {
    const r = res();
    const req = { method: "POST", url: "/api/exec" } as IncomingMessage;
    expect(gateDemoRequest(req, r as unknown as ServerResponse)).toBe(false);
    expect(r.statusCode).toBe(403);
    expect(JSON.parse(r.body)).toEqual({ error: "Not available in the demo." });
  });

  it("lets an allowed one through untouched", () => {
    const r = res();
    const req = { method: "GET", url: "/api/sessions" } as IncomingMessage;
    expect(gateDemoRequest(req, r as unknown as ServerResponse)).toBe(true);
    expect(r.body).toBe("");
  });

  it("refuses an upgrade with 403 and closes the socket", () => {
    const written: string[] = [];
    let destroyed = false;
    refuseDemoUpgrade({
      write: (s: string) => written.push(s),
      destroy: () => (destroyed = true),
    } as unknown as Duplex);
    expect(written.join("")).toMatch(/^HTTP\/1.1 403/);
    expect(destroyed).toBe(true);
  });
});

// server.ts is what makes these helpers matter: the request gate runs
// before Next handles anything, and upgrades are checked before routing.
describe("demo gate: wired into the server", () => {
  const server = fs.readFileSync(
    path.resolve(__dirname, "../../server.ts"),
    "utf8"
  );

  it("refuses requests before Next handles them", () => {
    const gate = server.indexOf(
      "if (demo && !gateDemoRequest(req, res)) return;"
    );
    expect(gate).toBeGreaterThan(-1);
    expect(gate).toBeLessThan(
      server.indexOf("await handle(req, res, parsedUrl)")
    );
  });

  it("admits demo chat sockets through their own cap", () => {
    expect(server).toMatch(
      /chatWss\.handleUpgrade\([^]*?if \(demo && !admitDemoSocket\(ws, request, chatSlots\)\) return;\s*chatWss\.emit\("connection"/
    );
    expect(server).toMatch(/const chatSlots = socketLimiter\(\);/);
  });

  it("admits demo status sockets through the cap", () => {
    expect(server).toMatch(
      /statusWss\.handleUpgrade\([^]*?if \(demo && !admitDemoSocket\(ws, request, statusSlots\)\) return;\s*statusWss\.emit\("connection"/
    );
  });

  it("refuses upgrades before any socket is handed over", () => {
    const gate = server.indexOf("if (demo && !demoAllowsUpgrade(pathname))");
    expect(gate).toBeGreaterThan(-1);
    expect(gate).toBeLessThan(server.indexOf('if (pathname === "/ws/chat")'));
  });
});

describe("admitDemoSocket", () => {
  const fakeSocket = () => {
    const ws = Object.assign(new EventEmitter(), {
      closed: null as null | [number, string],
      terminated: false,
      close(code: number, reason: string) {
        ws.closed = [code, reason];
      },
      terminate() {
        ws.terminated = true;
      },
    });
    return ws;
  };
  const from = (ip: string) =>
    ({ headers: {}, socket: { remoteAddress: ip } }) as unknown as Pick<
      IncomingMessage,
      "headers" | "socket"
    >;

  it("closes the client's fifth socket with 1013 and drops it if it hangs", () => {
    vi.useFakeTimers();
    try {
      const slots = socketLimiter();
      const open = Array.from({ length: DEMO_SOCKETS_PER_CLIENT }, () => {
        const ws = fakeSocket();
        expect(admitDemoSocket(ws, from("203.0.113.7"), slots)).toBe(true);
        return ws;
      });
      const extra = fakeSocket();
      expect(admitDemoSocket(extra, from("203.0.113.7"), slots)).toBe(false);
      expect(extra.closed).toEqual([1013, DEMO_BUSY_REASON]);
      // A bad frame before it's dropped is handled, not thrown.
      expect(() => extra.emit("error", new Error("bad frame"))).not.toThrow();
      expect(extra.terminated).toBe(true);
      extra.terminated = false;
      expect(extra.terminated).toBe(false);
      vi.advanceTimersByTime(1000);
      expect(extra.terminated).toBe(true);
      // Someone else still gets in, and a closed socket frees its slot.
      expect(admitDemoSocket(fakeSocket(), from("198.51.100.1"), slots)).toBe(
        true
      );
      open[0].emit("close");
      expect(admitDemoSocket(fakeSocket(), from("203.0.113.7"), slots)).toBe(
        true
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("behind a proxy, counts only toward the total", () => {
    const slots = socketLimiter(1, 3);
    const proxied = {
      headers: { "x-forwarded-for": "1.2.3.4" },
      socket: { remoteAddress: "172.17.0.1" },
    } as unknown as Pick<IncomingMessage, "headers" | "socket">;
    for (let i = 0; i < 3; i++)
      expect(admitDemoSocket(fakeSocket(), proxied, slots)).toBe(true);
    expect(admitDemoSocket(fakeSocket(), proxied, slots)).toBe(false);
  });
});

describe("demo socket client key", () => {
  it("is the visitor's address when they connect directly", () => {
    expect(demoClientKey("203.0.113.7", {})).toBe("203.0.113.7");
    expect(demoClientKey("::ffff:203.0.113.7", {})).toBe("203.0.113.7");
  });

  it("is none behind a proxy, on loopback or over Connect: total only", () => {
    expect(
      demoClientKey("172.17.0.1", { "x-forwarded-for": "1.2.3.4" })
    ).toBeNull();
    expect(demoClientKey("10.0.0.2", { via: "1.1 caddy" })).toBeNull();
    expect(demoClientKey("127.0.0.1", {})).toBeNull();
    expect(demoClientKey("::1", {})).toBeNull();
    expect(demoClientKey(undefined, {})).toBeNull();
  });

  it("ignores forwarding headers from a public peer, which chose them itself", () => {
    expect(demoClientKey("203.0.113.7", { "x-forwarded-for": "x" })).toBe(
      "203.0.113.7"
    );
    expect(demoClientKey("2001:db8:0:1::9", { via: "1" })).toBe(
      "2001:db8:0:1::/64"
    );
  });

  it("groups an IPv6 host's whole /64", () => {
    const key = demoClientKey("2001:db8:0:1::1", {});
    expect(key).toBe("2001:db8:0:1::/64");
    expect(demoClientKey("2001:db8:0:1:ffff:1:2:3", {})).toBe(key);
    expect(demoClientKey("2001:0db8:0000:0001::abcd", {})).toBe(key);
    expect(demoClientKey("2001:db8::1", {})).toBe("2001:db8:0:0::/64");
    expect(demoClientKey("2001:db8:0:2::1", {})).not.toBe(key);
  });
});

describe("demo socket limiter", () => {
  it("caps sockets per client", () => {
    const slots = socketLimiter(2, 10);
    const a = [slots.acquire("1.2.3.4"), slots.acquire("1.2.3.4")];
    expect(a.every(Boolean)).toBe(true);
    expect(slots.acquire("1.2.3.4")).toBeNull();
    expect(slots.acquire("5.6.7.8")).not.toBeNull();
  });

  it("caps sockets for everyone together", () => {
    const slots = socketLimiter(4, 3);
    expect(slots.acquire("a")).not.toBeNull();
    expect(slots.acquire("b")).not.toBeNull();
    expect(slots.acquire("c")).not.toBeNull();
    expect(slots.acquire("d")).toBeNull();
    expect(slots.count()).toBe(3);
  });

  it("frees a slot when its socket closes, once however often it's called", () => {
    const slots = socketLimiter(1, 1);
    const release = slots.acquire("a")!;
    expect(slots.acquire("a")).toBeNull();
    release();
    release();
    expect(slots.count()).toBe(0);
    expect(slots.count("a")).toBe(0);
    expect(slots.acquire("a")).not.toBeNull();
    expect(slots.acquire("b")).toBeNull();
  });

  it("counts a proxied socket (no client) toward the total only", () => {
    const slots = socketLimiter(1, 3);
    expect(slots.acquire(null)).not.toBeNull();
    expect(slots.acquire(null)).not.toBeNull();
    const release = slots.acquire(null)!;
    expect(release).not.toBeNull();
    expect(slots.acquire(null)).toBeNull();
    expect(slots.acquire("a")).toBeNull();
    release();
    expect(slots.count()).toBe(2);
    expect(slots.acquire("a")).not.toBeNull();
  });

  it("defaults to a few per client", () => {
    const slots = socketLimiter();
    for (let i = 0; i < DEMO_SOCKETS_PER_CLIENT; i++)
      expect(slots.acquire("a")).not.toBeNull();
    expect(slots.acquire("a")).toBeNull();
  });
});

import { describe, it, expect } from "vitest";
import { PEER_ROUTES, matchPeerRoute, peerTargetAllowed } from "./allowlist";

const concrete = (pattern: string) => pattern.replace(":id", "t-123_a.b");

describe("peer allowlist", () => {
  it.each(PEER_ROUTES.map((r) => [r.method, r.pattern]))(
    "allows %s %s",
    (method, pattern) => {
      expect(matchPeerRoute(method, concrete(pattern))).toMatchObject({
        ok: true,
        route: pattern,
      });
    }
  );

  it("lists the work registry's exchange ahead of its route", () => {
    expect(matchPeerRoute("POST", "/api/claims/exchange")).toMatchObject({
      ok: true,
      route: "/api/claims/exchange",
    });
    expect(matchPeerRoute("GET", "/api/claims/exchange").ok).toBe(false);
  });

  it.each([
    ["GET", "/api/machine/browser"],
    ["PATCH", "/api/machine"],
    ["GET", "/api/hosts/h-1/agents"],
    ["POST", "/api/pair/start"],
    ["POST", "/api/pair/claim"],
    ["GET", "/api/devices"],
    ["POST", "/api/devices/d-1/revoke"],
    ["DELETE", "/api/devices/d-1"],
    ["GET", "/api/hosts"],
    ["POST", "/api/hosts/h-1/link"],
    ["POST", "/api/connect/enrol"],
    ["GET", "/api/settings"],
    ["POST", "/api/settings/network"],
    ["GET", "/api/peers/account"],
    ["POST", "/api/peers/link"],
    ["POST", "/api/peer/rpc"],
    ["POST", "/api/exec"],
    ["GET", "/api/files"],
    ["GET", "/api/files/read"],
    ["GET", "/api/terminal"],
    ["POST", "/api/orchestrate/x"],
    ["POST", "/api/approvals/a/approve"],
    ["POST", "/api/presence/options"],
    ["GET", "/api/sessions/s-1/artifacts/a-1"],
    ["GET", "/api/tasks/t-1"],
  ])("denies %s %s", (method, path) => {
    expect(matchPeerRoute(method, path).ok).toBe(false);
  });

  it.each([
    "/api/tasks/../devices",
    "/api/tasks/./export",
    "/api/tasks/t-1/../../devices",
    "/api/tasks/%2e%2e/devices",
    "/api/tasks/%2E%2E/devices",
    "/api/tasks%2fimport",
    "/api/tasks/t%2f1/export",
    "//api/tasks",
    "/api//tasks",
    "/api/tasks/",
    "/api\\tasks",
    "/api/tasks\\..\\devices",
    "http://127.0.0.1:3011/api/tasks",
    "https://evil.example/api/tasks",
    "api/tasks",
    "/API/tasks",
    "/api/tasks?x=1",
    "/api/tasks#x",
    "/api/tasks\u0000",
    "/api/sessions/s 1/done",
    `/api/tasks/${"a".repeat(129)}/export`,
  ])("refuses the path trick %j", (path) => {
    expect(matchPeerRoute("POST", path).ok).toBe(false);
    expect(matchPeerRoute("GET", path).ok).toBe(false);
  });

  it("refuses an id with a slash in it", () => {
    expect(matchPeerRoute("POST", "/api/tasks/a/b/export").ok).toBe(false);
  });

  it("takes only each route's own query keys", () => {
    expect(
      matchPeerRoute("GET", "/api/tasks/t-1/chat-tail", "lines=40")
    ).toMatchObject({ ok: true, query: "lines=40" });
    expect(
      matchPeerRoute("GET", "/api/tasks/arrived", "from=h%201")
    ).toMatchObject({ ok: true, query: "from=h+1" });
    for (const [path, query] of [
      ["/api/tasks/t-1/chat-tail", "lines=40&path=/etc"],
      ["/api/tasks/t-1/chat-tail", "lines=1&lines=2"],
      ["/api/tasks/t-1/plan", "lines=40"],
      ["/api/sessions", "all=1"],
      ["/api/tasks/arrived", "from=x#y"],
      ["/api/tasks/arrived", `from=${"x".repeat(1025)}`],
    ])
      expect(matchPeerRoute("GET", path, query)).toMatchObject({
        ok: false,
        reason: "bad_query",
      });
  });

  it("matches the method too", () => {
    expect(matchPeerRoute("DELETE", "/api/tasks").ok).toBe(false);
    expect(matchPeerRoute("GET", "/api/tasks/t-1/merge").ok).toBe(false);
    expect(matchPeerRoute("PUT", "/api/sessions/s-1").ok).toBe(false);
    expect(matchPeerRoute("get", "/api/tasks").ok).toBe(false);
  });

  it("never matches an upgrade-only or unknown method", () => {
    for (const m of ["CONNECT", "UPGRADE", "OPTIONS", "TRACE", ""])
      expect(matchPeerRoute(m, "/api/sessions").ok).toBe(false);
  });

  it("checks a full request target for the gate", () => {
    expect(peerTargetAllowed("GET", "/api/tasks/t-1/chat-tail?lines=5")).toBe(
      true
    );
    expect(peerTargetAllowed("GET", "/api/tasks/t-1/chat-tail?x=5")).toBe(
      false
    );
    expect(peerTargetAllowed("GET", "/api/devices")).toBe(false);
    expect(peerTargetAllowed(undefined, undefined)).toBe(false);
  });
});

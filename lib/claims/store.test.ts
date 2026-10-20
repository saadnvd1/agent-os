import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { acceptExchange, answerExchange } from "./exchange";
import { machineId } from "./machine";
import {
  liveClaims,
  purgeExpired,
  release,
  upsertLocal,
  upsertRemote,
  wireFor,
} from "./store";
import { claimWire, type ClaimWire } from "./types";

const wire = (o: Partial<ClaimWire> = {}): ClaimWire => ({
  id: "r1",
  origin: "peer-1",
  origin_name: "box",
  hops: 0,
  source: "session",
  session_name: "Add oauth",
  repo: "github.com/acme/widgets",
  branch: "feature/oauth",
  base: "main",
  goal: "Add oauth",
  files: ["lib/auth.ts"],
  files_more: 0,
  pr_url: null,
  ttl_s: 600,
  age_s: 120,
  released: null,
  ...o,
});

const local = {
  sessionId: "sess-1",
  sessionName: "Local work",
  repo: "github.com/acme/widgets",
  branch: "feature/local",
  base: "main",
  goal: "Local work",
  files: ["a.ts"],
  filesMore: 0,
  prUrl: null,
};

beforeEach(() => {
  db.prepare(`DELETE FROM work_claims`).run();
});

describe("upsertRemote", () => {
  it("turns durations into this machine's clock", () => {
    const now = 1_000_000;
    upsertRemote(machineId(), "peer-1", wire(), now);
    const [c] = liveClaims({ now });
    expect(c.expiresAt).toBe(now + 600_000);
    expect(c.startedAt).toBe(now - 120_000);
    expect(liveClaims({ now: now + 601_000 })).toHaveLength(0);
  });

  it("caps the life a peer can give and ignores our own origin", () => {
    const self = machineId();
    upsertRemote(self, "peer-1", wire({ ttl_s: 86_000 }), 0);
    expect(liveClaims({ now: 1 })[0].expiresAt).toBe(15 * 60_000);
    expect(
      upsertRemote(self, "peer-1", wire({ id: "mine", origin: self }), 0)
    ).toBe(false);
  });

  it("drops absolute, escaping and over-long paths and cleans text", () => {
    upsertRemote(
      machineId(),
      "peer-1",
      wire({
        goal: "do\nit\u0007 now",
        files: ["/etc/passwd", "../x", "ok/file.ts", "a\0b", "x".repeat(400)],
      }),
      0
    );
    const [c] = liveClaims({ now: 1 });
    expect(c.files).toEqual(["ok/file.ts"]);
    expect(c.goal).toBe("do it now");
  });

  it("keeps a release over a stale live copy relayed later", () => {
    const self = machineId();
    upsertRemote(self, "peer-1", wire({ released: "merged", ttl_s: 900 }), 0);
    expect(
      upsertRemote(self, "peer-2", wire({ hops: 1, ttl_s: 300 }), 1000)
    ).toBe(false);
    expect(liveClaims({ now: 1000 })).toHaveLength(0);
  });

  it("rejects claims too many hops from their source", () => {
    expect(upsertRemote(machineId(), "p", wire({ hops: 3 }), 0)).toBe(false);
  });
});

describe("wire", () => {
  it("sends our claims with durations, and tombstones after release", () => {
    const self = machineId();
    upsertLocal({ id: self, name: "here" }, local, 0);
    const [w] = wireFor(self, {}, 30_000);
    expect(w).toMatchObject({ origin: self, hops: 0, ttl_s: 570, age_s: 30 });
    expect(claimWire.safeParse(w).success).toBe(true);
    release("sess-1", "merged", 40_000);
    expect(liveClaims({ now: 40_000 })).toHaveLength(0);
    expect(wireFor(self, {}, 41_000)[0].released).toBe("merged");
  });

  it("relays others' claims one hop further, never back to their origin or sender", () => {
    const self = machineId();
    upsertRemote(self, "peer-1", wire(), 0);
    expect(wireFor(self, {}, 1000)[0].hops).toBe(1);
    expect(wireFor(self, { machineId: "peer-1" }, 1000)).toHaveLength(0);
    upsertRemote(self, "peer-2", wire({ id: "r2", origin: "peer-3" }), 0);
    expect(
      wireFor(self, { machineId: "peer-3" }, 1000).map((c) => c.id)
    ).toEqual(["r1"]);
    upsertRemote(
      self,
      "peer-2",
      wire({ id: "r4", origin: "peer-4", hops: 2 }),
      0
    );
    expect(wireFor(self, {}, 1000).map((c) => c.id)).not.toContain("r4");
  });

  it("purges what has expired", () => {
    upsertRemote(machineId(), "p", wire(), 0);
    expect(purgeExpired(10_000_000)).toBe(1);
  });
});

describe("exchange", () => {
  it("takes a peer's claims and answers ours without echoing theirs", () => {
    upsertLocal({ id: machineId(), name: "here" }, local);
    const body = {
      machine: { id: "peer-1", name: "box" },
      claims: [wire({ ttl_s: 300 })],
    };
    expect(acceptExchange(body)).toBe(1);
    const reply = answerExchange(body);
    expect(reply.machine.id).toBe(machineId());
    expect(reply.claims.map((c) => c.id)).toEqual(["s-sess-1"]);
  });

  it("does nothing when sharing is off", async () => {
    const { putSetting } = await import("@/lib/settings-store");
    putSetting("claims.share", "off");
    try {
      const body = { machine: { id: "peer-1", name: "box" }, claims: [wire()] };
      expect(acceptExchange(body)).toBe(0);
      expect(answerExchange(body).claims).toEqual([]);
    } finally {
      putSetting("claims.share", null);
    }
  });
});

vi.setConfig({ testTimeout: 20000 });

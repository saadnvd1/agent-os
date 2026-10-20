import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { machineId } from "@/lib/claims/machine";
import { createConnectHost } from "@/lib/hosts";
import { putSetting } from "@/lib/settings-store";
import { savePin, suspendPin } from "@/lib/peer/links";
import { upsertLocal } from "@/lib/claims/store";
import { GET } from "./route";
import { POST } from "./exchange/route";

const post = (body: unknown) =>
  POST(
    new NextRequest("http://localhost/api/claims/exchange", {
      method: "POST",
      body: typeof body === "string" ? body : JSON.stringify(body),
    })
  );

beforeEach(() => {
  db.prepare(`DELETE FROM work_claims`).run();
});

const claim = {
  id: "r1",
  origin: "peer-1",
  origin_name: "box",
  goal: "Add oauth",
  repo: "github.com/acme/widgets",
  branch: "feature/oauth",
  files: ["a.ts"],
  ttl_s: 300,
  age_s: 5,
};

describe("POST /api/claims/exchange", () => {
  it("stores a peer's claims and answers with ours", async () => {
    upsertLocal(
      { id: machineId(), name: "here" },
      {
        sessionId: "s",
        sessionName: "Mine",
        repo: "github.com/acme/widgets",
        branch: "feature/mine",
        base: "main",
        goal: "Mine",
        files: [],
        filesMore: 0,
        prUrl: null,
      }
    );
    const res = await post({
      machine: { id: "peer-1", name: "box" },
      claims: [claim],
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.machine.id).toBe(machineId());
    expect(body.claims.map((c: { id: string }) => c.id)).toEqual(["s-s"]);
    const list = await (
      await GET(new NextRequest("http://localhost/api/claims"))
    ).json();
    expect(list.claims.map((c: { id: string }) => c.id).sort()).toEqual([
      "r1",
      "s-s",
    ]);
  });

  it("refuses bodies that are not claims", async () => {
    expect((await post("{nope")).status).toBe(400);
    expect(
      (await post({ machine: { id: "p", name: "n" }, claims: [{ id: "x" }] }))
        .status
    ).toBe(400);
    expect(
      (
        await post({
          machine: { id: "p", name: "n" },
          claims: [{ ...claim, ttl_s: -5 }],
        })
      ).status
    ).toBe(400);
  });
});

describe("POST /api/claims/exchange as a Connect peer", () => {
  const asPeer = (hostId: string | null) =>
    POST(
      new NextRequest("http://localhost/api/claims/exchange", {
        method: "POST",
        headers: {
          "x-agentos-trust": "peer",
          ...(hostId && { "x-agentos-peer": hostId }),
        },
        body: JSON.stringify({
          machine: { id: "peer-1", name: "box" },
          claims: [claim],
        }),
      })
    );

  it("refuses a host with no active pin and stores nothing", async () => {
    expect((await asPeer("no-such-host")).status).toBe(403);
    expect((await asPeer(null)).status).toBe(403);
    expect(db.prepare(`SELECT 1 FROM work_claims`).all()).toEqual([]);
  });

  it("refuses a suspended pin, and an active one keeps its via_host", async () => {
    const host = createConnectHost(`Spark-${Date.now()}`).id;
    savePin({
      hostId: host,
      machineId: "b2b2b2b2",
      hostname: "m-0123456789abcdef.runagentos.com",
      signPub: "s",
      boxPub: "b",
    });
    expect((await asPeer(host)).status).toBe(200);
    const via = () =>
      (
        db.prepare(`SELECT via_host FROM work_claims WHERE id='r1'`).get() as {
          via_host: string | null;
        }
      ).via_host;
    expect(via()).toBe(host);
    // A token caller re-sending it, with more life, must not clear the pin.
    await post({
      machine: { id: "peer-1", name: "box" },
      claims: [{ ...claim, ttl_s: 600 }],
    });
    expect(via()).toBe(host);
    suspendPin(host, "revoked");
    db.prepare(`DELETE FROM work_claims`).run();
    expect((await asPeer(host)).status).toBe(403);
    expect(db.prepare(`SELECT 1 FROM work_claims`).all()).toEqual([]);
  });

  it("writes nothing when sharing is off", async () => {
    const host = createConnectHost(`Studio-${Date.now()}`).id;
    savePin({
      hostId: host,
      machineId: "c3c3c3c3",
      hostname: "m-fedcba9876543210.runagentos.com",
      signPub: "s",
      boxPub: "b",
    });
    db.prepare(`DELETE FROM claim_peers`).run();
    putSetting("claims.share", "off");
    try {
      expect((await asPeer(host)).status).toBe(200);
    } finally {
      putSetting("claims.share", "on");
    }
    expect(db.prepare(`SELECT 1 FROM claim_peers`).all()).toEqual([]);
  });
});

describe("GET /api/claims", () => {
  it("rejects a bad query and an unknown session", async () => {
    const bad = await GET(
      new NextRequest(`http://localhost/api/claims?repo=${"x".repeat(400)}`)
    );
    expect(bad.status).toBe(400);
    const none = await GET(
      new NextRequest("http://localhost/api/claims?session=missing")
    );
    expect(none.status).toBe(404);
  });

  it("narrows to a repo and lists overlaps", async () => {
    await post({
      machine: { id: "peer-1", name: "box" },
      claims: [
        claim,
        {
          ...claim,
          id: "r2",
          origin: "peer-2",
          origin_name: "pc",
          repo: "github.com/acme/other",
        },
      ],
    });
    const body = await (
      await GET(
        new NextRequest(
          "http://localhost/api/claims?repo=github.com/acme/widgets"
        )
      )
    ).json();
    expect(body.claims.map((c: { id: string }) => c.id)).toEqual(["r1"]);
    expect(body.overlaps).toEqual([]);
  });
});

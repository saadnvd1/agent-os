import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { machineId } from "./machine";
import { endOutside, registerOutside } from "./outside";
import { liveClaims, upsertLocal, upsertRemote, wireFor } from "./store";
import { OUTSIDE_TTL_MS } from "./types";

beforeEach(() => {
  db.prepare(`DELETE FROM work_claims`).run();
});

const body = {
  remote: "git@github.com:acme/widgets.git",
  branch: "feature/search",
  goal: "Rework search",
  files: ["src/search.ts", "../etc/passwd", "/abs/path.ts"],
};

describe("outside claims", () => {
  it("registers under the repo key, drops unsafe paths, and renews by id", () => {
    const first = registerOutside({ ...body })!.claim;
    expect(first.source).toBe("outside");
    expect(first.repo).toBe("github.com/acme/widgets");
    expect(first.files).toEqual(["src/search.ts"]);
    const again = registerOutside({
      remote: body.remote,
      id: first.id,
      files: [],
    })!.claim;
    expect(again.id).toBe(first.id);
    expect(again.goal).toBe("Rework search");
    expect(liveClaims()).toHaveLength(1);
  });

  it("lives OUTSIDE_TTL_MS from its last touch", () => {
    const c = registerOutside({ ...body })!.claim;
    const left = c.expiresAt - c.updatedAt;
    expect(left).toBe(OUTSIDE_TTL_MS);
    expect(liveClaims({ now: c.updatedAt + OUTSIDE_TTL_MS + 1 })).toHaveLength(
      0
    );
  });

  it("refuses a remote that isn't a repository URL", () => {
    expect(registerOutside({ ...body, remote: "/srv/local/repo" })).toBeNull();
  });

  it("ends only its own outside claims", () => {
    const o = registerOutside({ ...body })!.claim;
    upsertLocal(
      { id: machineId(), name: "here" },
      {
        sessionId: "t1",
        sessionName: "Task",
        repo: "github.com/acme/widgets",
        branch: "x",
        base: "main",
        goal: "Task",
        files: [],
        filesMore: 0,
        prUrl: null,
      }
    );
    expect(endOutside("s-t1")).toBe("forbidden");
    expect(endOutside("o-00000000-0000-0000-0000-000000000000")).toBe(
      "missing"
    );
    expect(endOutside(o.id)).toBe("ended");
    expect(liveClaims().map((c) => c.id)).toEqual(["s-t1"]);
  });

  it("can't take over a peer's claim id", () => {
    const id = "o-11111111-1111-1111-1111-111111111111";
    upsertRemote("me", "peer-1", {
      id,
      origin: "peer-1",
      origin_name: "box",
      hops: 0,
      source: "outside",
      repo: "github.com/acme/widgets",
      goal: "Theirs",
      files: [],
      files_more: 0,
      ttl_s: 300,
      age_s: 0,
    });
    expect(registerOutside({ ...body, id })).toBeNull();
    expect(endOutside(id)).toBe("forbidden");
  });

  it("keeps its source on the wire", () => {
    registerOutside({ ...body });
    expect(wireFor(machineId())[0].source).toBe("outside");
  });
});

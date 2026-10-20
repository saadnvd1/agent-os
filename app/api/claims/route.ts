import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  claimsShared,
  findOverlaps,
  liveClaims,
  machineId,
  machineName,
  registerOutside,
} from "@/lib/claims";
import { outsideBody } from "@/lib/claims/types";
import { repoKey } from "@/lib/git-remote";
import { getDb, queries, type Session } from "@/lib/db";
import { expandHome } from "@/lib/tasks/session";

export const dynamic = "force-dynamic";

const query = z.object({
  session: z.string().max(100).optional(),
  repo: z.string().max(300).optional(),
});

// GET /api/claims - what live sessions, here and on linked machines, are
// working on, with the pairs that overlap. `session` narrows it to that
// session's repository.
export async function GET(request: NextRequest) {
  const q = query.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!q.success)
    return NextResponse.json({ error: "Bad query" }, { status: 400 });
  let repo = q.data.repo?.toLowerCase();
  if (q.data.session) {
    const s = queries.getSession(getDb()).get(q.data.session) as
      Session | undefined;
    if (!s)
      return NextResponse.json({ error: "No such session" }, { status: 404 });
    repo =
      (await repoKey(expandHome(s.worktree_path || s.working_directory))) ??
      undefined;
    if (!repo) return NextResponse.json(shape([]));
  }
  return NextResponse.json(shape(liveClaims({ repo })));
}

// POST /api/claims - a session AgentOS didn't start registers or renews its
// claim (`aos claim start|touch`). The CLI read git in its own folder and
// sends the remote URL, branch and paths; nothing is run here.
export async function POST(request: NextRequest) {
  const body = outsideBody.safeParse(await request.json().catch(() => null));
  if (!body.success)
    return NextResponse.json({ error: "Bad claim" }, { status: 400 });
  if (!claimsShared())
    return NextResponse.json({ error: "Claims are off" }, { status: 409 });
  const result = registerOutside(body.data);
  if (!result)
    return NextResponse.json(
      { error: "No repository remote, or that id belongs to another claim" },
      { status: 422 }
    );
  const claims = liveClaims({ repo: result.claim.repo });
  const overlaps = shape(claims).overlaps.filter(
    (o) => o.a === result.claim.id || o.b === result.claim.id
  );
  return NextResponse.json({ ...shape(claims), id: result.claim.id, overlaps });
}

function shape(claims: ReturnType<typeof liveClaims>) {
  return {
    machine: { id: machineId(), name: machineName() },
    claims,
    overlaps: findOverlaps(claims).map((o) => ({
      a: o.a.id,
      b: o.b.id,
      kinds: o.kinds,
      shared: o.shared,
      strength: o.strength,
    })),
  };
}

import { NextResponse } from "next/server";
import {
  listRemote,
  linked,
  createRemote,
  NOT_LINKED,
} from "@/lib/share/connect";
import { fail, readJson, refuseDemo, toResponse } from "@/lib/share/route";
import {
  EXPIRIES,
  TOO_BIG,
  buildPage,
  parseRequest,
} from "@/lib/share/service";
import { getArtifact, latestVersion } from "@/lib/artifacts/store";
import { insertSharedLink, listSharedLinks } from "@/lib/share/store";
import type { ShareExpiry } from "@/lib/connect/control-api";

// POST /api/shares - upload a snapshot to Connect and keep its link.
// The page is rendered again here from the same inputs as the preview and
// must hash the same: markup from the client is never uploaded.
export async function POST(request: Request) {
  const refused = refuseDemo();
  if (refused) return refused;
  const read = await readJson(request);
  if ("refused" in read) return read.refused;
  const body = read.body as Record<string, unknown>;
  try {
    const req = parseRequest(body, body?.sharedAt);
    const expiresIn = (body?.expiresIn ?? "7d") as ShareExpiry;
    if (!EXPIRIES.includes(expiresIn)) return fail("Unknown expiry.", 400);
    if (typeof body?.hash !== "string") return fail("hash is required.", 400);
    if (!linked()) return fail(NOT_LINKED, 409);

    const artifact = req.artifactId ? getArtifact(req.artifactId) : undefined;
    if (req.follow && artifact) {
      const latest = latestVersion(artifact.page_id);
      if (latest && latest.id !== artifact.id)
        return fail(
          `v${artifact.version} isn't the latest; share v${latest.version} to follow the page.`,
          409
        );
    }

    const page = await buildPage(req);
    if (page.tooBig) return fail(TOO_BIG, 413);
    if (page.hash !== body.hash)
      return fail("Changed since the preview; review it again.", 409);

    const share = await createRemote({
      kind: req.kind,
      title: page.title,
      html: page.html,
      markdown: page.markdown,
      expiresIn,
    });
    insertSharedLink({
      id: share.id,
      url: share.url,
      kind: req.kind,
      title: page.title,
      session_id: req.sessionId ?? null,
      artifact_id: req.artifactId ?? null,
      expires_at: share.expires_at,
      created_at: share.created_at,
      revoked_at: null,
      follow_latest: req.follow ? 1 : 0,
      version: artifact?.version ?? null,
    });
    return NextResponse.json(
      { id: share.id, url: share.url, expiresAt: share.expires_at },
      { status: 201 }
    );
  } catch (err) {
    return toResponse(err);
  }
}

// GET /api/shares - the links made here, with views and status from Connect
// when it can be reached.
export async function GET() {
  const refused = refuseDemo();
  if (refused) return refused;
  const local = listSharedLinks();
  let remote: Awaited<ReturnType<typeof listRemote>> | null = null;
  if (linked()) remote = await listRemote().catch(() => null);
  const byId = new Map(remote?.map((s) => [s.id, s]));
  const now = Date.now();
  return NextResponse.json({
    connect: !linked() ? "unlinked" : remote ? "ok" : "unavailable",
    shares: local.map((l) => {
      const r = byId.get(l.id);
      const status =
        r?.status ??
        (l.revoked_at
          ? "revoked"
          : l.expires_at && Date.parse(l.expires_at) <= now
            ? "expired"
            : "active");
      return {
        id: l.id,
        url: l.url,
        kind: l.kind,
        title: l.title,
        sessionId: l.session_id,
        artifactId: l.artifact_id,
        createdAt: l.created_at,
        expiresAt: l.expires_at,
        status,
        views: r ? r.view_count : null,
        lastViewedAt: r?.last_viewed_at ?? null,
        follow: l.follow_latest === 1,
        version: l.version,
      };
    }),
  });
}

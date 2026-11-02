import { NextResponse } from "next/server";
import { buildId } from "@/lib/build";

const startedAt = new Date(Date.now() - process.uptime() * 1000).toISOString();

// GET /api/health - the server is up and answering; when it started, so a
// deploy check can tell it restarted after a merge, and the build it runs, so
// a merge is only "deployed" when that build contains it (lib/away/deploy.ts).
export function GET() {
  return NextResponse.json({ ok: true, startedAt, build: buildId() });
}

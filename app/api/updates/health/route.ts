import { NextResponse } from "next/server";
import { buildId } from "@/lib/build";
import { db } from "@/lib/db";
import { migrationStatus } from "@/lib/db/migrations";

const startedAt = new Date(Date.now() - process.uptime() * 1000).toISOString();

// GET /api/updates/health - what scripts/update-run.mjs checks after an
// update's restart: the build this server runs, whether every migration it
// knows applied, and when it started (a change means it crashed and came back).
export function GET() {
  let migrations: { known: number; applied: number } | null = null;
  try {
    migrations = migrationStatus(db);
  } catch {}
  return NextResponse.json({
    ok: !!migrations,
    build: buildId(),
    startedAt,
    migrations,
  });
}

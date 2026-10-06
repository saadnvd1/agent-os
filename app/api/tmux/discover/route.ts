import { NextResponse } from "next/server";
import { getDb, queries, type Project, type Session } from "@/lib/db";
import { statusDetector } from "@/lib/status-detector";
import { discoverSessions } from "@/lib/hosts/discover";

// GET /api/tmux/discover - tmux sessions on every machine that agent-os didn't
// create, each matched to the project whose folder it runs in.
export async function GET() {
  const db = getDb();
  const tmuxSessions = await statusDetector.listSessions();
  const projects = queries.getAllProjects(db).all() as Project[];
  const managed = queries.getAllSessions(db).all() as Session[];
  return NextResponse.json({
    sessions: discoverSessions(tmuxSessions, projects, managed),
    hostErrors: statusDetector.hostErrors(),
  });
}

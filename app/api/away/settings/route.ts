import { NextRequest, NextResponse } from "next/server";
import { requireApprover } from "@/lib/security/approver";
import { awayWindowMinutes, setAwayWindowMinutes } from "@/lib/away/activity";

// GET /api/away/settings - how recent a session's last real turn must be
// for Away mode to touch it (lib/away/activity).
export function GET() {
  return NextResponse.json({ windowMinutes: awayWindowMinutes() });
}

// PUT /api/away/settings - { windowMinutes }. From a trusted place, as
// turning Away on is.
export async function PUT(request: NextRequest) {
  const gate = requireApprover(request);
  if (!gate.ok) return gate.response;
  try {
    const { windowMinutes } = (await request.json().catch(() => ({}))) as {
      windowMinutes?: unknown;
    };
    setAwayWindowMinutes(windowMinutes);
    return NextResponse.json({ windowMinutes: awayWindowMinutes() });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

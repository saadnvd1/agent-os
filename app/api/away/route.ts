import { NextRequest, NextResponse } from "next/server";
import { requireApprover } from "@/lib/security/approver";
import { getDevice } from "@/lib/security/devices";
import { turnAwayOff, turnAwayOn } from "@/lib/away/run";
import { awayView } from "@/lib/away/view";

// GET /api/away - whether Saad is away, and the report he hasn't dismissed.
export function GET() {
  return NextResponse.json(awayView());
}

// POST /api/away - { on: true, expiresAt: ISO | null } turns Away on (or
// moves its end); { on: false } turns it off and builds the report. From a
// trusted place, as Pause is: it changes what the orchestrators do.
export async function POST(request: NextRequest) {
  const gate = requireApprover(request);
  if (!gate.ok) return gate.response;
  const body = (await request.json().catch(() => ({}))) as {
    on?: unknown;
    expiresAt?: unknown;
  };
  if (typeof body.on !== "boolean")
    return NextResponse.json(
      { error: "on must be true or false" },
      { status: 400 }
    );
  if (!body.on) {
    turnAwayOff("saad");
    return NextResponse.json(awayView());
  }
  let expiresAt: number | null = null;
  if (body.expiresAt !== null && body.expiresAt !== undefined) {
    expiresAt =
      typeof body.expiresAt === "string" ? Date.parse(body.expiresAt) : NaN;
    if (!Number.isFinite(expiresAt))
      return NextResponse.json(
        { error: "expiresAt must be a time or null" },
        { status: 400 }
      );
  }
  const { approver } = gate;
  const setBy = approver.deviceId
    ? (getDevice(approver.deviceId)?.name ?? "a device")
    : approver.via === "loopback"
      ? "this machine"
      : "the tailnet";
  try {
    turnAwayOn({ setBy, expiresAt });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 400 }
    );
  }
  return NextResponse.json(awayView());
}

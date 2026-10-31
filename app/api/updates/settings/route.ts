import { NextRequest, NextResponse } from "next/server";
import { requireApprover } from "@/lib/security/approver";
import {
  IDLE_MINUTES,
  autoLocked,
  bannerLocked,
  idleMinutesLocked,
  setAutoEnabled,
  setBannerEnabled,
  setIdleMinutes,
} from "@/lib/updates/settings";
import { updateView } from "@/lib/updates/view";

const conflict = (error: string) =>
  NextResponse.json({ error }, { status: 409 });

// PUT /api/updates/settings {banner?, auto?, idleMinutes?} - show the update
// banner, install updates automatically, and how long everything must be
// idle first.
export async function PUT(request: NextRequest) {
  const allowed = requireApprover(request);
  if (!allowed.ok) return allowed.response;
  const body = (await request.json().catch(() => null)) as {
    banner?: unknown;
    auto?: unknown;
    idleMinutes?: unknown;
  } | null;
  const { banner, auto, idleMinutes } = body ?? {};
  if (
    (banner === undefined && auto === undefined && idleMinutes === undefined) ||
    (banner !== undefined && typeof banner !== "boolean") ||
    (auto !== undefined && typeof auto !== "boolean") ||
    (idleMinutes !== undefined &&
      !(IDLE_MINUTES as readonly unknown[]).includes(idleMinutes))
  )
    return NextResponse.json(
      {
        error: `Send banner or auto (true or false), or idleMinutes (${IDLE_MINUTES.join(", ")}).`,
      },
      { status: 400 }
    );
  if (banner !== undefined && bannerLocked())
    return conflict("The banner is pinned off by AGENTOS_UPDATE_BANNER.");
  if (auto !== undefined && autoLocked())
    return conflict("Automatic updates are pinned off by AGENTOS_AUTO_UPDATE.");
  if (idleMinutes !== undefined && idleMinutesLocked())
    return conflict("The idle time is pinned by AGENTOS_AUTO_UPDATE_IDLE_MIN.");
  if (typeof banner === "boolean") setBannerEnabled(banner);
  if (typeof auto === "boolean") setAutoEnabled(auto);
  if (typeof idleMinutes === "number") setIdleMinutes(idleMinutes);
  return NextResponse.json(await updateView({ mayUpdate: true }));
}

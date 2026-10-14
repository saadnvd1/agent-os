import { NextRequest, NextResponse } from "next/server";
import { requireApprover } from "@/lib/security/approver";
import { bannerLocked, setBannerEnabled } from "@/lib/updates/settings";
import { updateView } from "@/lib/updates/view";

// PUT /api/updates/settings {banner: boolean} - show the update banner or not.
export async function PUT(request: NextRequest) {
  const allowed = requireApprover(request);
  if (!allowed.ok) return allowed.response;
  const body = (await request.json().catch(() => null)) as {
    banner?: unknown;
  } | null;
  if (typeof body?.banner !== "boolean")
    return NextResponse.json(
      { error: "banner must be true or false." },
      { status: 400 }
    );
  if (bannerLocked())
    return NextResponse.json(
      { error: "The banner is pinned off by AGENTOS_UPDATE_BANNER." },
      { status: 409 }
    );
  setBannerEnabled(body.banner);
  return NextResponse.json(await updateView({ mayUpdate: true }));
}

import { NextRequest, NextResponse } from "next/server";
import { checkReach } from "@/lib/reach/checkReach";
import { classifyReach } from "@/lib/reach/classify";
import { demoMode } from "@/lib/security/demo";
import type { ReachRoute } from "@/lib/reach/types";

const ROUTES = new Set<string>(["connect", "tailscale", "lan"]);

// GET /api/reach[?fresh][&want=lan,connect] - can other devices reach this
// machine, and if not, why. `want` adds routes the caller means to use.
export async function GET(request: NextRequest) {
  if (demoMode()) return NextResponse.json(demoReach());
  const params = request.nextUrl.searchParams;
  const want = (params.get("want") ?? "")
    .split(",")
    .filter((r): r is ReachRoute => ROUTES.has(r));
  return NextResponse.json(await checkReach(params.has("fresh"), want));
}

// Nothing about the machine a demo runs on.
function demoReach() {
  return classifyReach({
    now: Date.now(),
    port: 3011,
    lan: { on: false, addresses: [] },
    firewall: "unknown",
    tailscale: { state: "missing" },
    connect: { state: "off", linked: false, enabled: false },
  });
}

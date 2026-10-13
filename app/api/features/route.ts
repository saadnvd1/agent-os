import { NextRequest, NextResponse } from "next/server";
import { featureViews } from "@/lib/plans/view";

export async function GET(request: NextRequest) {
  return NextResponse.json({
    features: featureViews(request.nextUrl.searchParams.get("workspace")),
  });
}

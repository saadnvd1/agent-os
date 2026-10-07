import { NextResponse } from "next/server";
import { collectStatuses } from "@/lib/status/collect";

export async function GET() {
  try {
    return NextResponse.json(await collectStatuses());
  } catch (error) {
    console.error("Error getting session statuses:", error);
    return NextResponse.json({ statuses: {} });
  }
}

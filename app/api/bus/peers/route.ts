import { NextResponse } from "next/server";
import { listPeers } from "@/lib/bus";

export async function GET() {
  return NextResponse.json({ peers: await listPeers() });
}

import { NextResponse } from "next/server";
import { experimentsView } from "@/lib/experiments/view";

// GET /api/experiments - every experiment, whether it's on, and what it used
export function GET() {
  return NextResponse.json(experimentsView());
}

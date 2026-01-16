import { NextResponse } from "next/server";
import { isRipgrepAvailable } from "@/lib/code-search";

export async function GET() {
  try {
    const available = isRipgrepAvailable();
    return NextResponse.json({ available });
  } catch (error) {
    console.error("Error checking ripgrep availability:", error);
    return NextResponse.json({ available: false });
  }
}

import { NextResponse } from "next/server";
import { pendingCards } from "@/lib/learning-cards";

// Every pending learning card, for the sidebar's badges.
export async function GET() {
  return NextResponse.json({ cards: pendingCards() });
}

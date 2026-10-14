import { NextResponse } from "next/server";
import { cardsFor } from "@/lib/learning-cards";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return NextResponse.json({ cards: cardsFor(id) });
}

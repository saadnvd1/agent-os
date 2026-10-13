import { NextRequest, NextResponse } from "next/server";
import { recipeDraft } from "@/lib/recipes/draft";
import { failed } from "@/lib/recipes/api";

// A finished session as a recipe form: prefilled, with a drafted brief when
// the model could write one. Saves nothing.
export async function POST(request: NextRequest) {
  try {
    const { sessionId } = await request.json();
    return NextResponse.json(await recipeDraft(String(sessionId ?? "")));
  } catch (error) {
    return failed(error);
  }
}

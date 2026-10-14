import { NextRequest, NextResponse } from "next/server";
import { recipeDraft } from "@/lib/recipes/draft";
import { pendingRecipeDraft } from "@/lib/learning-cards";
import { failed } from "@/lib/recipes/api";

// A finished session as a recipe form: prefilled, with a drafted brief when
// the model could write one. Saves nothing.
export async function POST(request: NextRequest) {
  try {
    const { sessionId } = await request.json();
    const id = String(sessionId ?? "");
    // A learning card may have drafted it already.
    return NextResponse.json(
      await recipeDraft(id, undefined, pendingRecipeDraft(id))
    );
  } catch (error) {
    return failed(error);
  }
}

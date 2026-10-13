import { NextRequest, NextResponse } from "next/server";
import { previewPrompt } from "@/lib/recipes";
import { failed, resolveRecipe } from "@/lib/recipes/api";

// What a run started now would send, for the Run sheet.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const q = request.nextUrl.searchParams;
    const recipe = resolveRecipe((await params).id, q.get("workspace"));
    return NextResponse.json({
      prompt: previewPrompt(recipe.id, q.get("note")),
    });
  } catch (error) {
    return failed(error, 404);
  }
}

import { NextRequest, NextResponse } from "next/server";
import { clearCarry } from "@/lib/recipes";
import { failed, resolveRecipe } from "@/lib/recipes/api";

// The next run starts without the last run's summary.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const recipe = resolveRecipe(
      (await params).id,
      request.nextUrl.searchParams.get("workspace")
    );
    clearCarry(recipe.id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return failed(error);
  }
}

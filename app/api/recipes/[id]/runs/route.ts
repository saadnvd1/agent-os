import { NextRequest, NextResponse } from "next/server";
import { listRuns } from "@/lib/recipes";
import { failed, resolveRecipe } from "@/lib/recipes/api";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const recipe = resolveRecipe(
      (await params).id,
      request.nextUrl.searchParams.get("workspace")
    );
    const q = request.nextUrl.searchParams;
    const runs = listRuns(recipe.id, {
      before: q.get("before") ? Number(q.get("before")) : undefined,
      limit: q.get("limit") ? Number(q.get("limit")) : undefined,
    });
    return NextResponse.json({ runs });
  } catch (error) {
    return failed(error, 404);
  }
}

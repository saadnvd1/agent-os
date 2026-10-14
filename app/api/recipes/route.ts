import { NextRequest, NextResponse } from "next/server";
import {
  createRecipe,
  listRecipeViews,
  recipeView,
  setTimer,
} from "@/lib/recipes";
import { acceptRecipeCardFor } from "@/lib/learning-cards/apply";
import { failed } from "@/lib/recipes/api";

export async function GET(request: NextRequest) {
  const workspace = request.nextUrl.searchParams.get("workspace");
  return NextResponse.json({ recipes: listRecipeViews(workspace) });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const recipe = createRecipe({
      workspaceId: body.workspaceId,
      projectId: body.projectId,
      name: body.name,
      kind: body.kind,
      brief: body.brief,
      model: body.model,
      view: body.view,
      autoDone: body.autoDone,
      maxMinutes: body.maxMinutes,
      sourceSessionId: body.sourceSessionId,
    });
    if (typeof body.sourceSessionId === "string")
      acceptRecipeCardFor(body.sourceSessionId, recipe.id);
    if (body.timer) setTimer(recipe, body.timer);
    return NextResponse.json({ recipe: recipeView(recipe) }, { status: 201 });
  } catch (error) {
    return failed(error);
  }
}

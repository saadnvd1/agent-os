import { NextRequest, NextResponse } from "next/server";
import {
  archiveRecipe,
  listRuns,
  recipeView,
  setTimer,
  updateRecipe,
} from "@/lib/recipes";
import { failed, resolveRecipe } from "@/lib/recipes/api";

type Params = { params: Promise<{ id: string }> };

const workspaceOf = (request: NextRequest) =>
  request.nextUrl.searchParams.get("workspace");

export async function GET(request: NextRequest, { params }: Params) {
  try {
    const recipe = resolveRecipe((await params).id, workspaceOf(request));
    return NextResponse.json({
      recipe: recipeView(recipe),
      runs: listRuns(recipe.id),
    });
  } catch (error) {
    return failed(error, 404);
  }
}

// The timer is Saad's: it can ride along with the settings here.
export async function PATCH(request: NextRequest, { params }: Params) {
  try {
    const recipe = resolveRecipe((await params).id, workspaceOf(request));
    const body = await request.json();
    const { timer, ...patch } = body;
    const updated = updateRecipe(recipe.id, patch);
    if (timer !== undefined) setTimer(updated, timer);
    return NextResponse.json({ recipe: recipeView(updated) });
  } catch (error) {
    return failed(error);
  }
}

// Archives it: off the list and its timer off, its runs kept.
export async function DELETE(request: NextRequest, { params }: Params) {
  try {
    const recipe = resolveRecipe((await params).id, workspaceOf(request));
    archiveRecipe(recipe.id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return failed(error);
  }
}

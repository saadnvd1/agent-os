// Shared by the recipes routes: errors as JSON, and finding a recipe by id
// or by name (with a workspace).

import { NextResponse } from "next/server";
import { findRecipe, getRecipe } from "./store";
import type { Recipe } from "./types";

export const failed = (error: unknown, status = 400) =>
  NextResponse.json(
    { error: error instanceof Error ? error.message : String(error) },
    { status }
  );

export function resolveRecipe(ref: string, workspace?: string | null): Recipe {
  const byId = getRecipe(ref);
  if (byId && !byId.archived_at) return byId;
  if (!workspace) throw new Error(`No recipe "${ref}"`);
  return findRecipe(workspace, ref);
}

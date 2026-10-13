import { proxy } from "valtio";
import { settingsUiActions } from "./settingsUi";

// Settings > Recipes: one workspace's, or all of them. A recipe opened from
// elsewhere (a session's menu, the palette), or a finished session to save
// as one, lands here.
export const recipesUi = proxy<{
  workspaceId: string | null;
  recipeId: string | null;
  fromSessionId: string | null;
  runRecipeId: string | null;
}>({
  workspaceId: null,
  recipeId: null,
  fromSessionId: null,
  runRecipeId: null,
});

export const recipesUiActions = {
  open: (workspaceId: string | null = null) => {
    Object.assign(recipesUi, {
      workspaceId,
      recipeId: null,
      fromSessionId: null,
      runRecipeId: null,
    });
    settingsUiActions.open("recipes");
  },
  openRecipe: (recipeId: string, run = false) => {
    Object.assign(recipesUi, {
      recipeId,
      fromSessionId: null,
      runRecipeId: run ? recipeId : null,
    });
    settingsUiActions.open("recipes");
  },
  saveSessionAs: (sessionId: string, workspaceId: string | null = null) => {
    Object.assign(recipesUi, {
      workspaceId,
      recipeId: null,
      fromSessionId: sessionId,
      runRecipeId: null,
    });
    settingsUiActions.open("recipes");
  },
  clear: () => {
    Object.assign(recipesUi, {
      recipeId: null,
      fromSessionId: null,
      runRecipeId: null,
    });
  },
};

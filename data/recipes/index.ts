import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { RecipeInput, RecipeRun, RecipeView } from "@/lib/recipes/types";
import type { RecipeDraft } from "@/lib/recipes/draft";
import type { TimerInput } from "@/lib/recipes/timer";
import { sessionKeys } from "../sessions/keys";
import { taskKeys } from "../tasks";
import { usePollWhenOffline } from "../push/connection";

export const recipeKeys = {
  all: ["recipes"] as const,
  list: (workspaceId: string | null) =>
    [...recipeKeys.all, "list", workspaceId ?? "all"] as const,
  detail: (id: string) => [...recipeKeys.all, "detail", id] as const,
  preview: (id: string, note: string) =>
    [...recipeKeys.all, "preview", id, note] as const,
};

async function call<T>(
  url: string,
  method = "GET",
  body?: unknown
): Promise<T> {
  const res = await fetch(url, {
    method,
    headers:
      body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

export function useRecipesQuery(workspaceId: string | null, enabled = true) {
  return useQuery({
    queryKey: recipeKeys.list(workspaceId),
    queryFn: async () =>
      (
        await call<{ recipes: RecipeView[] }>(
          `/api/recipes${workspaceId ? `?workspace=${workspaceId}` : ""}`
        )
      ).recipes,
    enabled,
    // Pushed when recipes or their runs change.
    refetchInterval: usePollWhenOffline(15000),
  });
}

export function useRecipeQuery(id: string | null) {
  return useQuery({
    queryKey: recipeKeys.detail(id ?? ""),
    queryFn: () =>
      call<{ recipe: RecipeView; runs: RecipeRun[] }>(`/api/recipes/${id}`),
    enabled: !!id,
    refetchInterval: usePollWhenOffline(10000),
  });
}

// What a run started now would send, for the Run sheet.
export function usePreviewQuery(id: string, note: string, enabled: boolean) {
  return useQuery({
    queryKey: recipeKeys.preview(id, note),
    queryFn: () =>
      call<{ prompt: string }>(
        `/api/recipes/${id}/preview${note ? `?note=${encodeURIComponent(note)}` : ""}`
      ),
    enabled,
  });
}

function useRecipeMutation<V, R>(fn: (v: V) => Promise<R>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: recipeKeys.all });
      queryClient.invalidateQueries({ queryKey: taskKeys.all });
      queryClient.invalidateQueries({ queryKey: sessionKeys.all });
    },
  });
}

export type RecipeFormInput = RecipeInput & { timer?: TimerInput | null };

export function useCreateRecipe() {
  return useRecipeMutation((input: RecipeFormInput) =>
    call<{ recipe: RecipeView }>("/api/recipes", "POST", input)
  );
}

export function useUpdateRecipe() {
  return useRecipeMutation(
    ({
      id,
      ...patch
    }: Partial<Omit<RecipeFormInput, "workspaceId">> & { id: string }) =>
      call<{ recipe: RecipeView }>(`/api/recipes/${id}`, "PATCH", patch)
  );
}

export function useArchiveRecipe() {
  return useRecipeMutation((id: string) =>
    call(`/api/recipes/${id}`, "DELETE")
  );
}

export function useRunRecipe() {
  return useRecipeMutation(
    (input: { id: string; note?: string; requestId: string }) =>
      call<{ run: RecipeRun; queued: boolean }>(
        `/api/recipes/${input.id}/run`,
        "POST",
        { note: input.note, requestId: input.requestId }
      )
  );
}

export function useClearCarry() {
  return useRecipeMutation((id: string) =>
    call(`/api/recipes/${id}/carry/clear`, "POST", {})
  );
}

export function useRecipeDraft() {
  return useMutation({
    mutationFn: (sessionId: string) =>
      call<RecipeDraft>("/api/recipes/draft", "POST", { sessionId }),
  });
}

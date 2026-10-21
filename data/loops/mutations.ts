import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { CriterionDraft, Limits, LoopView } from "@/lib/loops/types";
import { loopKeys } from "./keys";

async function call<T>(
  url: string,
  method: string,
  body?: unknown
): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Something went wrong");
  return data as T;
}

const base = (taskId: string) =>
  `/api/tasks/${encodeURIComponent(taskId)}/loop`;

function useAct<I>(run: (input: I) => Promise<unknown>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: run,
    onSettled: () => void client.invalidateQueries({ queryKey: loopKeys.all }),
  });
}

export const useDraftCriteria = (taskId: string) =>
  useMutation({
    mutationFn: () =>
      call<{ criteria: CriterionDraft[] }>(
        `${base(taskId)}/draft-criteria`,
        "POST",
        {}
      ).then((r) => r.criteria),
  });

export const useStartLoop = (taskId: string) =>
  useAct((input: { criteria: CriterionDraft[]; limits: Partial<Limits> }) =>
    call<{ view: LoopView }>(base(taskId), "POST", input)
  );

export interface LoopEdit {
  extend?: { cycles?: number; costUsd?: number; minutes?: number };
  addCriteria?: CriterionDraft[];
  editCriteria?: { id: number; text: string }[];
  removeCriteria?: number[];
  waive?: number[];
}

export const useEditLoop = (taskId: string) =>
  useAct((input: LoopEdit) =>
    call<{ view: LoopView }>(base(taskId), "PATCH", input)
  );

export const useStopLoop = (taskId: string) =>
  useAct(() => call<{ view: LoopView }>(`${base(taskId)}/stop`, "POST", {}));

export const useRunLoop = (taskId: string) =>
  useAct(() => call<{ view: LoopView }>(`${base(taskId)}/run`, "POST", {}));

export const useNextInstruction = (taskId: string) =>
  useAct((input: { action: "send" | "hold" | "skip"; instruction?: string }) =>
    call<{ view: LoopView }>(`${base(taskId)}/next`, "POST", input)
  );

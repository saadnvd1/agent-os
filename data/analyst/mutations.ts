import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { AnalystLinkView, Recommendation } from "@/lib/analyst/types";
import { sessionKeys } from "../sessions/keys";
import { analystKeys } from "./keys";

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

const link = (id: string) => `/api/analyst/${encodeURIComponent(id)}`;
const rec = (id: string, recId: string, action: string) =>
  `${link(id)}/recommendations/${encodeURIComponent(recId)}/${action}`;

function useRefresh() {
  const client = useQueryClient();
  return () => {
    void client.invalidateQueries({ queryKey: analystKeys.all });
  };
}

export interface StartAnalystInput {
  coderSessionId?: string;
  newCoder?: {
    projectId: string;
    agentType: string;
    model?: string;
    prompt?: string;
    useWorktree?: boolean;
  };
  analystModel?: string;
  reviewLast?: boolean;
}

export function useStartAnalyst() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: StartAnalystInput) =>
      call<{ link: AnalystLinkView }>("/api/analyst", "POST", input).then(
        (r) => r.link
      ),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: analystKeys.all });
      void client.invalidateQueries({ queryKey: sessionKeys.all });
    },
  });
}

export function useSendRecommendation(linkId: string) {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: ({ recId, text }: { recId: string; text?: string }) =>
      call<{ recommendation: Recommendation }>(
        rec(linkId, recId, "send"),
        "POST",
        text === undefined ? {} : { text }
      ),
    onSettled: refresh,
  });
}

export function useDismissRecommendation(linkId: string) {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (recId: string) =>
      call(rec(linkId, recId, "dismiss"), "POST", {}),
    onSettled: refresh,
  });
}

export function useAskAgain(linkId: string) {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (recId: string) =>
      call(rec(linkId, recId, "again"), "POST", {}),
    onSettled: refresh,
  });
}

export function useReviewNow(linkId: string) {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: () => call(`${link(linkId)}/review`, "POST", {}),
    onSettled: refresh,
  });
}

export function useSetAnalystPaused(linkId: string) {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (paused: boolean) => call(link(linkId), "PATCH", { paused }),
    onSettled: refresh,
  });
}

export function useEndAnalyst(linkId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (endAnalyst: boolean) =>
      call(link(linkId), "DELETE", { endAnalyst }),
    onSettled: () => {
      void client.invalidateQueries({ queryKey: analystKeys.all });
      void client.invalidateQueries({ queryKey: sessionKeys.all });
    },
  });
}

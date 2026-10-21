import { useMutation } from "@tanstack/react-query";
import {
  exportFileName,
  rangeSlug,
  type ExportEstimate,
  type ExportRequest,
} from "@/lib/export/view";

export type {
  ExportEstimate,
  ExportRequest,
  ExportTurnInfo,
  ExportWarning,
} from "@/lib/export/view";

const post = (url: string, body: unknown) =>
  fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

async function failure(res: Response): Promise<never> {
  const data = await res.json().catch(() => ({}));
  throw new Error(data.error || "Export failed");
}

/** What an export would hold: size, turns, warnings. No file text. */
export function useExportEstimate(sessionId: string) {
  return useMutation({
    mutationFn: async (req: ExportRequest): Promise<ExportEstimate> => {
      const res = await post(`/api/sessions/${sessionId}/export/estimate`, req);
      return res.ok ? res.json() : failure(res);
    },
  });
}

/** The file itself, as the server built it. */
export async function fetchExport(
  sessionId: string,
  req: ExportRequest,
  title: string,
  sel: { from: number; to: number; of: number } | null
): Promise<{ blob: Blob; name: string }> {
  const res = await post(`/api/sessions/${sessionId}/export`, req);
  if (!res.ok) return failure(res);
  return {
    blob: await res.blob(),
    name: exportFileName(title, sel ? rangeSlug(sel) : "all", req.format),
  };
}

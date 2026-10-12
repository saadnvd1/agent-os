"use client";

import { Markdown } from "@/components/Chat/Markdown";
import { useTaskLogQuery } from "@/data/session-logs";

// A merged task's stored log, as the document AgentOS wrote.
export function LogDocument({ sessionId }: { sessionId: string }) {
  const { data, isPending, isError, error } = useTaskLogQuery(sessionId);
  if (isPending)
    return <div className="bg-muted/40 m-4 h-40 animate-pulse rounded-lg" />;
  if (isError)
    return <p className="text-destructive p-4 text-sm">{error.message}</p>;
  if (!data)
    return (
      <p className="text-muted-foreground p-4 text-sm">This task has no log.</p>
    );
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl px-4 py-4">
        <Markdown text={data.markdown} />
        {data.header.filePath && (
          <p className="text-muted-foreground mt-4 border-t pt-3 text-xs break-all">
            Also saved at {data.header.filePath}
          </p>
        )}
      </div>
    </div>
  );
}

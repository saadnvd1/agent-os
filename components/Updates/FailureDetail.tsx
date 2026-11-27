"use client";

// The last lines of a failed update's output, folded away until asked for.
export function FailureDetail({
  lines,
  logPath,
}: {
  lines: string[];
  logPath?: string;
}) {
  if (!lines.length && !logPath) return null;
  return (
    <details className="text-muted-foreground mt-1 text-xs">
      <summary className="min-h-11 cursor-pointer py-2.5 md:min-h-0 md:py-0">
        Show what failed
      </summary>
      {lines.length > 0 && (
        <pre
          data-testid="update-failure-output"
          className="bg-muted/60 mt-1 max-h-60 overflow-auto rounded-md p-2 font-mono break-words whitespace-pre-wrap"
        >
          {lines.join("\n")}
        </pre>
      )}
      {logPath && <p className="mt-1 break-all">Full log: {logPath}</p>}
    </details>
  );
}

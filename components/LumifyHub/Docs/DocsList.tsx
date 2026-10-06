"use client";

import { useMemo, useState } from "react";
import { ChevronRight, FileText, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { ShimmeringLoader } from "@/components/ui/skeleton";
import { useDocs } from "@/data/lumifyhub/docs";
import { docRows } from "@/lib/lumifyhub/doc-tree";
import { compactTimeAgo } from "@/lib/session-meta";
import { docsUiActions } from "@/stores/docsUi";

function DocsSkeleton() {
  return (
    <div className="space-y-1">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="flex h-11 items-center gap-3 px-3">
          <ShimmeringLoader className="h-4 w-4" delayIndex={i} />
          <ShimmeringLoader className="h-4 flex-1" delayIndex={i} />
          <ShimmeringLoader className="h-3 w-8" delayIndex={i} />
        </div>
      ))}
    </div>
  );
}

export function DocsList({ workspaceId }: { workspaceId: string }) {
  const { data: docs, isPending, isError, error } = useDocs(workspaceId);
  const [query, setQuery] = useState("");
  const rows = useMemo(() => docRows(docs ?? [], query), [docs, query]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="relative">
        <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
        <Input
          aria-label="Search docs"
          placeholder="Search docs"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="h-11 pl-9 sm:h-9"
        />
      </div>
      <div className="-mx-2 min-h-40 flex-1 overflow-y-auto">
        {isPending && <DocsSkeleton />}
        {isError && (
          <p className="text-destructive px-3 py-6 text-center text-sm">
            {error.message}
          </p>
        )}
        {docs && rows.length === 0 && (
          <p className="text-muted-foreground py-8 text-center text-sm">
            {query ? "No docs match." : "No docs in this workspace yet."}
          </p>
        )}
        {rows.map(({ doc, depth }) => (
          <button
            key={doc.id}
            type="button"
            onClick={() => docsUiActions.read(doc.id)}
            className="hover:bg-foreground/[0.04] flex min-h-11 w-full items-center gap-2 rounded-lg px-3 text-left"
            style={{ paddingLeft: `${0.75 + Math.min(depth, 6) * 1}rem` }}
          >
            {depth > 0 ? (
              <ChevronRight className="text-muted-foreground/50 h-3 w-3 shrink-0" />
            ) : (
              <FileText className="text-muted-foreground h-4 w-4 shrink-0" />
            )}
            <span className="min-w-0 flex-1 truncate text-sm">{doc.title}</span>
            <span className="text-muted-foreground/70 shrink-0 font-mono text-[11px] tabular-nums">
              {compactTimeAgo(new Date(doc.updatedAt))}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

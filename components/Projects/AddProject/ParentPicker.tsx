"use client";

import { useState } from "react";
import { FolderBrowser } from "./FolderBrowser";

// Where a new project's folder goes, changeable in place.
export function ParentPicker({
  hostId,
  path,
  onChange,
}: {
  hostId: string;
  path: string;
  onChange: (path: string) => void;
}) {
  const [browsing, setBrowsing] = useState(false);
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-sm">
        <span className="text-muted-foreground shrink-0">In</span>
        <code className="min-w-0 flex-1 truncate text-xs">{path}</code>
        <button
          type="button"
          onClick={() => setBrowsing(!browsing)}
          className="text-primary min-h-11 shrink-0 px-1 text-sm md:min-h-8"
        >
          {browsing ? "Done" : "Change"}
        </button>
      </div>
      {browsing && (
        <FolderBrowser hostId={hostId} path={path} onNavigate={onChange} />
      )}
    </div>
  );
}

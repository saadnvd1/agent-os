"use client";

import { useRef, useEffect } from "react";
import { X, File } from "lucide-react";
import { cn } from "@/lib/utils";
import type { OpenFile } from "@/hooks/useFileEditor";

interface FileTabsProps {
  files: OpenFile[];
  activeFilePath: string | null;
  onSelect: (path: string) => void;
  onClose: (path: string) => void;
  isDirty: (path: string) => boolean;
}

export function FileTabs({
  files,
  activeFilePath,
  onSelect,
  onClose,
  isDirty,
}: FileTabsProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const activeTabRef = useRef<HTMLButtonElement>(null);

  // Scroll active tab into view
  useEffect(() => {
    if (activeTabRef.current && scrollRef.current) {
      activeTabRef.current.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
        inline: "center",
      });
    }
  }, [activeFilePath]);

  if (files.length === 0) {
    return null;
  }

  return (
    <div
      ref={scrollRef}
      className="flex items-center gap-0.5 overflow-x-auto bg-muted/30 px-1 scrollbar-none"
    >
      {files.map((file) => {
        const isActive = file.path === activeFilePath;
        const dirty = isDirty(file.path);
        const fileName = file.path.split("/").pop() || file.path;
        const ext = fileName.split(".").pop()?.toLowerCase() || "";

        return (
          <button
            key={file.path}
            ref={isActive ? activeTabRef : null}
            onClick={() => onSelect(file.path)}
            className={cn(
              "flex items-center gap-1.5 px-3 py-2 text-sm whitespace-nowrap transition-colors",
              "min-h-[40px] md:min-h-[36px]",
              "hover:bg-accent/50",
              isActive
                ? "bg-background text-foreground"
                : "text-muted-foreground"
            )}
          >
            <FileIcon extension={ext} />
            <span className="max-w-[120px] truncate">{fileName}</span>
            {dirty && (
              <span className="w-2 h-2 rounded-full bg-primary flex-shrink-0" />
            )}
            <button
              onClick={(e) => {
                e.stopPropagation();
                onClose(file.path);
              }}
              className={cn(
                "p-0.5 rounded hover:bg-accent ml-1 flex-shrink-0",
                "opacity-0 group-hover:opacity-100",
                isActive && "opacity-100"
              )}
            >
              <X className="w-3 h-3" />
            </button>
          </button>
        );
      })}
    </div>
  );
}

function FileIcon({ extension }: { extension: string }) {
  const colorMap: Record<string, string> = {
    js: "text-yellow-400",
    jsx: "text-yellow-400",
    ts: "text-blue-400",
    tsx: "text-blue-400",
    css: "text-pink-400",
    scss: "text-pink-400",
    html: "text-orange-400",
    xml: "text-orange-400",
    json: "text-green-400",
    yaml: "text-purple-400",
    yml: "text-purple-400",
    md: "text-blue-300",
    py: "text-green-500",
  };

  const color = colorMap[extension] || "text-muted-foreground";
  return <File className={cn("w-3.5 h-3.5 flex-shrink-0", color)} />;
}

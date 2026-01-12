"use client";

import { useEffect, useRef } from "react";
import hljs from "highlight.js";
import "highlight.js/styles/github-dark.css";
import { Copy, Check, X, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { getLanguageFromExtension } from "@/lib/file-utils";

interface FileViewerProps {
  content: string;
  filePath: string;
  isBinary: boolean;
  onClose?: () => void;
}

/**
 * Read-only file viewer with syntax highlighting
 * Mobile-optimized with full-screen view
 */
export function FileViewer({ content, filePath, isBinary, onClose }: FileViewerProps) {
  const codeRef = useRef<HTMLElement>(null);
  const [copied, setCopied] = useState(false);

  // Get file extension for language detection
  const extension = filePath.split(".").pop() || "";
  const language = getLanguageFromExtension(extension);

  // Apply syntax highlighting
  useEffect(() => {
    if (codeRef.current && !isBinary) {
      hljs.highlightElement(codeRef.current);
    }
  }, [content, isBinary]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API might fail
    }
  };

  return (
    <div className="h-full w-full flex flex-col bg-background">
      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b border-border bg-background/95 backdrop-blur-sm sticky top-0 z-10">
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-medium truncate" title={filePath}>
            {filePath.split("/").pop()}
          </h3>
          <p className="text-xs text-muted-foreground truncate">
            {filePath}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {!isBinary && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleCopy}
              className="h-8"
            >
              {copied ? (
                <>
                  <Check className="w-4 h-4 mr-1" />
                  Copied
                </>
              ) : (
                <>
                  <Copy className="w-4 h-4 mr-1" />
                  Copy
                </>
              )}
            </Button>
          )}

          {onClose && (
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={onClose}
              className="h-8 w-8"
            >
              <X className="w-4 h-4" />
            </Button>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {isBinary ? (
          <div className="p-4 text-center text-muted-foreground">
            <FileText className="w-12 h-12 mx-auto mb-2 opacity-50" />
            <p>{content}</p>
          </div>
        ) : (
          <pre className="m-0 p-4 text-sm overflow-x-auto">
            <code
              ref={codeRef}
              className={cn(
                "language-" + language,
                "block"
              )}
            >
              {content}
            </code>
          </pre>
        )}
      </div>
    </div>
  );
}

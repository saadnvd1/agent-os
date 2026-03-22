"use client";

import { useMemo } from "react";

interface HtmlRendererProps {
  content: string;
}

export function HtmlRenderer({ content }: HtmlRendererProps) {
  const srcDoc = useMemo(() => content, [content]);

  return (
    <iframe
      srcDoc={srcDoc}
      sandbox="allow-scripts"
      className="h-full w-full border-0 bg-white"
      title="HTML Preview"
    />
  );
}

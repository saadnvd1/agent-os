"use client";

interface HtmlRendererProps {
  content: string;
}

export function HtmlRenderer({ content }: HtmlRendererProps) {
  return (
    <iframe
      srcDoc={content}
      sandbox=""
      className="h-full w-full border-0 bg-white"
      title="HTML Preview"
    />
  );
}

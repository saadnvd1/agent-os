"use client";

import { useEffect, useId, useState } from "react";
import { useTheme } from "next-themes";
import { CopyButton } from "./CopyButton";

// A mermaid diagram, drawn once its source stops changing (it streams in),
// and shown as source when it doesn't parse.
export function Mermaid({ code }: { code: string }) {
  const { resolvedTheme } = useTheme();
  const id = `mermaid-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const [svg, setSvg] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          theme: resolvedTheme === "light" ? "default" : "dark",
        });
        const { svg } = await mermaid.render(id, code);
        if (!cancelled) {
          setSvg(svg);
          setFailed(false);
        }
      } catch {
        if (!cancelled) setFailed(true);
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [code, id, resolvedTheme]);

  return (
    <div className="bg-foreground/[0.03] not-prose relative my-3 rounded-xl p-3">
      <CopyButton
        text={code}
        label="Copy diagram source"
        className="absolute top-1 right-1"
      />
      {svg && !failed ? (
        <div
          className="flex justify-center overflow-x-auto [&_svg]:h-auto [&_svg]:max-h-80 [&_svg]:max-w-full"
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      ) : (
        <pre className="text-muted-foreground overflow-x-auto font-mono text-xs whitespace-pre">
          {code}
        </pre>
      )}
    </div>
  );
}

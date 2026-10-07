"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useTheme } from "next-themes";
import { cn } from "@/lib/utils";
import { parseTheme } from "@/lib/theme-config";

// Agent output, never the app: scripts run, but with an opaque origin and no
// same-origin access. The server sends the same sandbox as a CSP header.
export const ARTIFACT_IFRAME_SANDBOX = "allow-scripts allow-forms";

export const artifactUrl = (id: string) =>
  `/api/artifacts/${encodeURIComponent(id)}`;

// A page an agent showed. Inline it fits the page's reported height between
// the bounds; filling, it takes its container.
export function ArtifactFrame({
  artifactId,
  title,
  fill = false,
  maxHeight = 720,
  className,
}: {
  artifactId: string;
  title: string;
  fill?: boolean;
  maxHeight?: number;
  className?: string;
}) {
  const { resolvedTheme } = useTheme();
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(240);

  useEffect(() => {
    if (fill) return;
    const onMessage = (e: MessageEvent) => {
      if (e.source !== ref.current?.contentWindow) return;
      const h = (e.data as { agentosArtifactHeight?: unknown } | null)
        ?.agentosArtifactHeight;
      if (typeof h === "number" && Number.isFinite(h))
        setHeight(Math.round(Math.min(Math.max(h, 80), maxHeight)));
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [fill, maxHeight]);

  // The page's prefers-color-scheme follows the frame's color-scheme.
  const style: CSSProperties = {
    // Themes are named by mode and variant ("light-warm", "dark-ocean").
    colorScheme:
      parseTheme(resolvedTheme ?? "dark").mode === "light" ? "light" : "dark",
    ...(fill ? {} : { height }),
  };
  return (
    <iframe
      ref={ref}
      src={artifactUrl(artifactId)}
      title={title}
      sandbox={ARTIFACT_IFRAME_SANDBOX}
      referrerPolicy="no-referrer"
      loading="lazy"
      className={cn(
        "block w-full border-0 bg-transparent",
        fill && "h-full",
        className
      )}
      style={style}
    />
  );
}

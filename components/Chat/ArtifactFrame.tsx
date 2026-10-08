"use client";

import { useEffect, useRef, type CSSProperties } from "react";
import { useTheme } from "next-themes";
import { cn } from "@/lib/utils";
import { parseTheme } from "@/lib/theme-config";
import { useRowState } from "./rowState";

// Agent output, never the app: scripts run, but with an opaque origin and no
// same-origin access. The server sends the same sandbox as a CSP header.
export const ARTIFACT_IFRAME_SANDBOX = "allow-scripts allow-forms";

export const artifactUrl = (id: string) =>
  `/api/artifacts/${encodeURIComponent(id)}`;

// The height a page reports for itself, clamped; null for anything else.
export function artifactHeight(data: unknown, max: number): number | null {
  const h = (data as { agentosArtifactHeight?: unknown } | null)
    ?.agentosArtifactHeight;
  if (typeof h !== "number" || !Number.isFinite(h)) return null;
  return Math.round(Math.min(Math.max(h, 80), max));
}

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
  const [height, setHeight] = useRowState(`artifact:${artifactId}`, 240);

  useEffect(() => {
    if (fill) return;
    const onMessage = (e: MessageEvent) => {
      if (e.source !== ref.current?.contentWindow) return;
      const h = artifactHeight(e.data, maxHeight);
      if (h !== null) setHeight(h);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [fill, maxHeight, setHeight]);

  // The page's prefers-color-scheme follows the frame's color-scheme.
  const style: CSSProperties = {
    // Themes are named by mode and variant ("light-warm", "dark-ocean").
    colorScheme:
      parseTheme(resolvedTheme ?? "dark").mode === "light" ? "light" : "dark",
    // Never taller than most of a phone's screen, so the chat still scrolls.
    ...(fill ? {} : { height, maxHeight: "60dvh" }),
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

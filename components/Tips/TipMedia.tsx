"use client";

import { Maximize2, Play } from "lucide-react";
import { useTheme } from "next-themes";
import { useRef, useState } from "react";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { MediaViewer } from "@/components/Media/MediaViewer";
import { pickSrc } from "@/components/Media/viewer";
import type { Media } from "@/lib/tips/schema";

/** A tip's still or clip, sized by its own dimensions so nothing jumps as it loads. */
export function TipMedia({ media }: { media: Media }) {
  const { resolvedTheme } = useTheme();
  const reduced = useMediaQuery("(prefers-reduced-motion: reduce)");
  const [played, setPlayed] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const dark = !!resolvedTheme && !resolvedTheme.startsWith("light");
  const frame =
    "bg-muted relative max-h-[40dvh] w-full overflow-hidden rounded-lg";
  const style = { aspectRatio: `${media.width} / ${media.height}` };
  const src = pickSrc(media, dark);
  const expand = (
    <>
      <button
        type="button"
        aria-label={`Expand ${media.kind === "image" ? "image" : "clip"}: ${media.alt}`}
        onClick={() => setExpanded(true)}
        className="focus-visible:ring-ring absolute inset-0 cursor-zoom-in focus-visible:ring-2 focus-visible:outline-none"
      >
        <span
          aria-hidden
          className="absolute top-2 right-2 grid size-7 place-items-center rounded-md bg-black/60 text-white"
        >
          <Maximize2 className="size-3.5" />
        </span>
      </button>
      <MediaViewer
        media={{
          kind: media.kind,
          src,
          alt: media.alt,
          width: media.width,
          height: media.height,
          poster: media.kind === "video" ? media.poster : undefined,
        }}
        open={expanded}
        onOpenChange={setExpanded}
      />
    </>
  );

  if (media.kind === "image")
    return (
      <div className={frame} style={style}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={media.alt}
          width={media.width}
          height={media.height}
          loading="lazy"
          decoding="async"
          className="size-full object-contain"
        />
        {expand}
      </div>
    );

  const still = reduced && !played;
  return (
    <div className={frame} style={style}>
      <video
        ref={video}
        key={media.src}
        src={media.src}
        poster={media.poster}
        aria-label={media.alt}
        width={media.width}
        height={media.height}
        muted
        loop
        playsInline
        autoPlay={!reduced}
        preload={reduced ? "none" : "metadata"}
        className="size-full object-contain"
      />
      {expand}
      {still && (
        <button
          type="button"
          aria-label="Play clip"
          onClick={() => {
            setPlayed(true);
            void video.current?.play();
          }}
          className="absolute top-1/2 left-1/2 z-10 -translate-x-1/2 -translate-y-1/2"
        >
          <span className="bg-background/90 grid size-11 place-items-center rounded-full shadow">
            <Play className="size-5" />
          </span>
        </button>
      )}
    </div>
  );
}

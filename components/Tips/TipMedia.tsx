"use client";

import { Play } from "lucide-react";
import { useTheme } from "next-themes";
import { useRef, useState } from "react";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import type { Media } from "@/lib/tips/schema";

/** A tip's still or clip, sized by its own dimensions so nothing jumps as it loads. */
export function TipMedia({ media }: { media: Media }) {
  const { resolvedTheme } = useTheme();
  const reduced = useMediaQuery("(prefers-reduced-motion: reduce)");
  const [played, setPlayed] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const dark = !!resolvedTheme && !resolvedTheme.startsWith("light");
  const frame =
    "bg-muted relative max-h-[40dvh] w-full overflow-hidden rounded-lg";
  const style = { aspectRatio: `${media.width} / ${media.height}` };

  if (media.kind === "image")
    return (
      <div className={frame} style={style}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={dark && media.srcDark ? media.srcDark : media.src}
          alt={media.alt}
          width={media.width}
          height={media.height}
          loading="lazy"
          decoding="async"
          className="size-full object-contain"
        />
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
      {still && (
        <button
          type="button"
          aria-label="Play clip"
          onClick={() => {
            setPlayed(true);
            void video.current?.play();
          }}
          className="absolute inset-0 grid place-items-center bg-black/20"
        >
          <span className="bg-background/90 grid size-11 place-items-center rounded-full shadow">
            <Play className="size-5" />
          </span>
        </button>
      )}
    </div>
  );
}

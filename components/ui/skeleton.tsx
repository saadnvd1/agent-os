"use client";

import { forwardRef } from "react";
import { cn } from "@/lib/utils";

interface ShimmeringLoaderProps {
  className?: string;
  delayIndex?: number;
  animationDelay?: number;
}

export const ShimmeringLoader = forwardRef<HTMLDivElement, ShimmeringLoaderProps>(
  ({ className, delayIndex = 0, animationDelay = 150 }, ref) => {
    return (
      <div
        ref={ref}
        className={cn(
          "h-4 rounded bg-muted animate-pulse",
          className
        )}
        style={{
          animationFillMode: "backwards",
          animationDelay: `${delayIndex * animationDelay}ms`,
        }}
      />
    );
  }
);
ShimmeringLoader.displayName = "ShimmeringLoader";

interface GenericSkeletonLoaderProps {
  className?: string;
}

export function GenericSkeletonLoader({ className }: GenericSkeletonLoaderProps) {
  return (
    <div className={cn("space-y-2", className)}>
      <ShimmeringLoader />
      <ShimmeringLoader className="w-3/4" />
      <ShimmeringLoader className="w-1/2" />
    </div>
  );
}

interface SessionCardSkeletonProps {
  count?: number;
}

export function SessionCardSkeleton({ count = 3 }: SessionCardSkeletonProps) {
  return (
    <div className="space-y-2 p-2">
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-3 p-3 rounded-lg bg-accent/30"
        >
          <ShimmeringLoader className="w-8 h-8 rounded-full" delayIndex={i} />
          <div className="flex-1 space-y-2">
            <ShimmeringLoader className="w-32 h-4" delayIndex={i} />
            <ShimmeringLoader className="w-20 h-3" delayIndex={i} />
          </div>
        </div>
      ))}
    </div>
  );
}

interface ProjectSectionSkeletonProps {
  count?: number;
}

export function ProjectSectionSkeleton({ count = 2 }: ProjectSectionSkeletonProps) {
  return (
    <div className="space-y-4 p-2">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="space-y-2">
          <div className="flex items-center gap-2 px-2">
            <ShimmeringLoader className="w-4 h-4" delayIndex={i} />
            <ShimmeringLoader className="w-24 h-4" delayIndex={i} />
          </div>
          <SessionCardSkeleton count={2} />
        </div>
      ))}
    </div>
  );
}

interface DevServerSkeletonProps {
  count?: number;
}

export function DevServerSkeleton({ count = 2 }: DevServerSkeletonProps) {
  return (
    <div className="space-y-2">
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="flex items-center justify-between p-3 rounded-lg bg-accent/30"
        >
          <div className="flex items-center gap-3">
            <ShimmeringLoader className="w-3 h-3 rounded-full" delayIndex={i} />
            <ShimmeringLoader className="w-24 h-4" delayIndex={i} />
          </div>
          <ShimmeringLoader className="w-16 h-6 rounded" delayIndex={i} />
        </div>
      ))}
    </div>
  );
}

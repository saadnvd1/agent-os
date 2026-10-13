"use client";

import { useState } from "react";
import { ArrowLeft, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useSimulatorStatus } from "@/data/simulator";
import { cn } from "@/lib/utils";

export const shotUrl = (file: string) =>
  `/api/files/image?path=${encodeURIComponent(file)}`;

// The phone icon on a task whose simulator is up; tapping it opens the
// latest screenshots.
export function SimulatorIndicator({ sessionId }: { sessionId: string }) {
  const { data } = useSimulatorStatus(sessionId);
  const [open, setOpen] = useState(false);
  if (data?.state !== "ready") return null;
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          size="sm"
          variant="outline"
          className="h-11 md:h-8"
          aria-label={`Simulator booted, ${data.shots.length} screenshots`}
        >
          <Smartphone className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
          {data.shots.length > 0 && (
            <span className="font-mono text-[11px]">{data.shots.length}</span>
          )}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Simulator</DialogTitle>
          <DialogDescription>
            Latest screenshots, newest last.
          </DialogDescription>
        </DialogHeader>
        <ScreenshotStrip shots={data.shots} />
      </DialogContent>
    </Dialog>
  );
}

export function ScreenshotStrip({ shots }: { shots: string[] }) {
  const [selected, setSelected] = useState<string | null>(null);
  if (shots.length === 0)
    return <p className="text-muted-foreground text-sm">No screenshots yet.</p>;
  if (selected)
    return (
      <div className="space-y-3">
        <Button
          size="sm"
          variant="ghost"
          className="h-11 md:h-8"
          onClick={() => setSelected(null)}
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          All screenshots
        </Button>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={shotUrl(selected)}
          alt="Simulator screenshot"
          className="mx-auto max-h-[70dvh] w-auto rounded-lg border"
        />
      </div>
    );
  return (
    <ul className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-2">
      {shots.map((file, i) => (
        <li key={file} className="shrink-0">
          <button
            type="button"
            onClick={() => setSelected(file)}
            aria-label={`Screenshot ${i + 1} of ${shots.length}`}
            className={cn(
              "bg-foreground/[0.04] focus-visible:ring-ring block min-h-11 min-w-11 overflow-hidden rounded-lg border focus-visible:ring-2 focus-visible:outline-none"
            )}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={shotUrl(file)}
              alt=""
              loading="lazy"
              className="h-40 w-auto"
            />
          </button>
        </li>
      ))}
    </ul>
  );
}

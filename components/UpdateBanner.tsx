"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { ArrowDownToLine, Loader2, RefreshCw } from "lucide-react";
import { Button } from "./ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { useUpdateCheckQuery, useApplyUpdate } from "@/data/system";
import { toast } from "sonner";

const DISMISSED_KEY = "agent-os-dismissed-update-version";

export function UpdateBanner() {
  const { data } = useUpdateCheckQuery();
  const applyUpdate = useApplyUpdate();
  const [updating, setUpdating] = useState(false);
  const [pollError, setPollError] = useState(false);
  const toastShownRef = useRef<string | null>(null);

  // Show toast on first detection of a new version
  useEffect(() => {
    if (!data?.updateAvailable || !data.latest) return;

    const dismissed = localStorage.getItem(DISMISSED_KEY);
    if (dismissed === data.latest) return;
    if (toastShownRef.current === data.latest) return;

    toastShownRef.current = data.latest;
    toast.info(`Update available: v${data.latest}`);
    localStorage.setItem(DISMISSED_KEY, data.latest);
  }, [data?.updateAvailable, data?.latest]);

  // Poll for server to come back after update
  const pollForRestart = useCallback((expectedVersion: string) => {
    setUpdating(true);
    setPollError(false);

    const startTime = Date.now();
    const timeout = 5 * 60 * 1000; // 5 min

    const interval = setInterval(async () => {
      if (Date.now() - startTime > timeout) {
        clearInterval(interval);
        setPollError(true);
        return;
      }

      try {
        const res = await fetch("/api/system/version");
        if (!res.ok) return;
        const json = await res.json();
        if (json.current === expectedVersion) {
          clearInterval(interval);
          window.location.reload();
        }
      } catch {
        // Server is down during update, keep polling
      }
    }, 3000);

    return () => clearInterval(interval);
  }, []);

  const handleUpdate = async () => {
    if (!data?.latest) return;
    try {
      await applyUpdate.mutateAsync();
      pollForRestart(data.latest);
    } catch {
      toast.error("Failed to start update");
    }
  };

  // Fullscreen updating overlay
  if (updating) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-black/80 backdrop-blur-sm">
        {pollError ? (
          <>
            <RefreshCw className="text-muted-foreground h-8 w-8" />
            <p className="text-lg font-medium text-white">
              Update may have failed
            </p>
            <p className="text-muted-foreground max-w-sm text-center text-sm">
              Try running <code className="text-white">agent-os update</code>{" "}
              manually from your terminal, then refresh this page.
            </p>
            <Button
              variant="secondary"
              onClick={() => window.location.reload()}
            >
              Refresh page
            </Button>
          </>
        ) : (
          <>
            <Loader2 className="h-8 w-8 animate-spin text-purple-400" />
            <p className="text-lg font-medium text-white">
              Updating AgentOS...
            </p>
            <p className="text-muted-foreground text-sm">
              The server will restart automatically
            </p>
          </>
        )}
      </div>
    );
  }

  if (!data?.updateAvailable || !data.latest) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" className="relative">
          <ArrowDownToLine className="h-4 w-4" />
          <span className="absolute -top-1 -right-1 h-2.5 w-2.5 rounded-full bg-green-500" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="text-xs font-normal">
          <span className="text-muted-foreground">v{data.current}</span>
          <span className="text-muted-foreground mx-1.5">&rarr;</span>
          <span className="font-medium text-green-500">v{data.latest}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <div className="p-1.5">
          <Button
            size="sm"
            className="w-full"
            onClick={handleUpdate}
            disabled={applyUpdate.isPending}
          >
            {applyUpdate.isPending ? (
              <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
            ) : (
              <ArrowDownToLine className="mr-1.5 h-3 w-3" />
            )}
            Update now
          </Button>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

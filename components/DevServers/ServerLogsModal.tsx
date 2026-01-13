"use client";

import { useState, useEffect, useRef } from "react";
import { X, RefreshCw, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface ServerLogsModalProps {
  serverId: string;
  serverName: string;
  onClose: () => void;
}

export function ServerLogsModal({
  serverId,
  serverName,
  onClose,
}: ServerLogsModalProps) {
  const [logs, setLogs] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const logsRef = useRef<HTMLDivElement>(null);

  const fetchLogs = async (isRefresh = false) => {
    if (isRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    try {
      const res = await fetch(`/api/dev-servers/${serverId}/logs?lines=200`);
      if (res.ok) {
        const data = await res.json();
        setLogs(data.logs || []);
      }
    } catch (err) {
      console.error("Failed to fetch logs:", err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  // Initial fetch
  useEffect(() => {
    fetchLogs();
  }, [serverId]);

  // Auto-scroll to bottom when logs update
  useEffect(() => {
    if (logsRef.current) {
      logsRef.current.scrollTop = logsRef.current.scrollHeight;
    }
  }, [logs]);

  // Auto-refresh every 3 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      fetchLogs(true);
    }, 3000);
    return () => clearInterval(interval);
  }, [serverId]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div
        className={cn(
          "w-full max-w-3xl h-[80vh] flex flex-col rounded-xl",
          "bg-background border border-border",
          "shadow-2xl"
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-lg font-semibold truncate">
            Logs: {serverName}
          </h2>
          <div className="flex items-center gap-2">
            <button
              onClick={() => fetchLogs(true)}
              disabled={refreshing}
              className={cn(
                "rounded-md p-1.5 hover:bg-muted transition-colors",
                "disabled:opacity-50"
              )}
              title="Refresh"
            >
              <RefreshCw
                className={cn("h-4 w-4", refreshing && "animate-spin")}
              />
            </button>
            <button
              onClick={onClose}
              className="rounded-md p-1.5 hover:bg-muted transition-colors"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Logs content */}
        <div
          ref={logsRef}
          className={cn(
            "flex-1 overflow-auto p-4",
            "bg-zinc-950 font-mono text-sm leading-relaxed"
          )}
        >
          {loading ? (
            <div className="flex h-full items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              <span className="ml-2 text-muted-foreground">Loading logs...</span>
            </div>
          ) : logs.length === 0 ? (
            <div className="flex h-full items-center justify-center text-muted-foreground">
              No logs available
            </div>
          ) : (
            <div className="space-y-0.5">
              {logs.map((line, i) => (
                <div
                  key={i}
                  className={cn(
                    "whitespace-pre-wrap break-all",
                    line.includes("error") || line.includes("Error")
                      ? "text-red-400"
                      : line.includes("warn") || line.includes("Warning")
                      ? "text-yellow-400"
                      : "text-zinc-300"
                  )}
                >
                  {line || " "}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-border px-4 py-2 text-xs text-muted-foreground">
          Auto-refreshing every 3 seconds
          {refreshing && (
            <span className="ml-2">
              <RefreshCw className="inline h-3 w-3 animate-spin" />
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

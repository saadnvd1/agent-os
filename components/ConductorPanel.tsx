"use client";

import { useState, useEffect, useCallback } from "react";
import { WorkerCard, type WorkerInfo, type WorkerStatus } from "./WorkerCard";
import { Button } from "./ui/button";
import {
  RefreshCw,
  Users,
  CheckCircle,
  Loader2,
  AlertCircle,
  XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface WorkersSummary {
  total: number;
  pending: number;
  running: number;
  waiting: number;
  completed: number;
  failed: number;
}

interface ConductorPanelProps {
  conductorSessionId: string;
  onAttachToWorker?: (workerId: string) => void;
}

export function ConductorPanel({
  conductorSessionId,
  onAttachToWorker,
}: ConductorPanelProps) {
  const [workers, setWorkers] = useState<WorkerInfo[]>([]);
  const [summary, setSummary] = useState<WorkersSummary | null>(null);
  const [expandedWorkers, setExpandedWorkers] = useState<Set<string>>(
    new Set()
  );
  const [workerOutputs, setWorkerOutputs] = useState<Record<string, string>>(
    {}
  );
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchWorkers = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/orchestrate/workers?conductorId=${conductorSessionId}`
      );
      const data = await res.json();
      if (data.workers) {
        setWorkers(data.workers);
      }
    } catch (error) {
      console.error("Failed to fetch workers:", error);
    }
  }, [conductorSessionId]);

  const fetchSummary = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/orchestrate/workers?conductorId=${conductorSessionId}&summary=true`
      );
      const data = await res.json();
      if (data.summary) {
        setSummary(data.summary);
      }
    } catch (error) {
      console.error("Failed to fetch summary:", error);
    }
  }, [conductorSessionId]);

  const fetchWorkerOutput = useCallback(async (workerId: string) => {
    try {
      const res = await fetch(`/api/orchestrate/workers/${workerId}?lines=30`);
      const data = await res.json();
      if (data.output) {
        setWorkerOutputs((prev) => ({ ...prev, [workerId]: data.output }));
      }
    } catch (error) {
      console.error("Failed to fetch worker output:", error);
    }
  }, []);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([fetchWorkers(), fetchSummary()]);
    setRefreshing(false);
  }, [fetchWorkers, fetchSummary]);

  // Initial load
  useEffect(() => {
    const load = async () => {
      setLoading(true);
      await Promise.all([fetchWorkers(), fetchSummary()]);
      setLoading(false);
    };
    load();
  }, [fetchWorkers, fetchSummary]);

  // Poll for updates every 5 seconds
  useEffect(() => {
    const interval = setInterval(refresh, 5000);
    return () => clearInterval(interval);
  }, [refresh]);

  // Fetch output for expanded workers
  useEffect(() => {
    expandedWorkers.forEach((workerId) => {
      if (!workerOutputs[workerId]) {
        fetchWorkerOutput(workerId);
      }
    });
  }, [expandedWorkers, workerOutputs, fetchWorkerOutput]);

  const toggleExpand = (workerId: string) => {
    setExpandedWorkers((prev) => {
      const next = new Set(prev);
      if (next.has(workerId)) {
        next.delete(workerId);
      } else {
        next.add(workerId);
        // Fetch output when expanding
        fetchWorkerOutput(workerId);
      }
      return next;
    });
  };

  const handleSendMessage = async (workerId: string, message: string) => {
    try {
      await fetch(`/api/orchestrate/workers/${workerId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "send", message }),
      });
      // Refresh output after sending
      setTimeout(() => fetchWorkerOutput(workerId), 1000);
    } catch (error) {
      console.error("Failed to send message:", error);
    }
  };

  const handleKillWorker = async (workerId: string) => {
    if (!confirm("Kill this worker?")) return;
    try {
      await fetch(`/api/orchestrate/workers/${workerId}`, {
        method: "DELETE",
      });
      await refresh();
    } catch (error) {
      console.error("Failed to kill worker:", error);
    }
  };

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="text-muted-foreground h-6 w-6 animate-spin" />
      </div>
    );
  }

  if (workers.length === 0) {
    return (
      <div className="text-muted-foreground flex h-full flex-col items-center justify-center">
        <Users className="mb-4 h-12 w-12 opacity-50" />
        <p className="text-lg font-medium">No workers yet</p>
        <p className="text-sm">This conductor hasn't spawned any workers.</p>
        <p className="mt-4 max-w-md text-center text-xs">
          Use the MCP tools or API to spawn workers. The conductor can delegate
          tasks to parallel worker sessions.
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header with summary */}
      <div className="flex items-center justify-between border-b p-4">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Users className="text-primary h-5 w-5" />
            <span className="font-semibold">Workers</span>
            <span className="text-muted-foreground">
              ({summary?.total || workers.length})
            </span>
          </div>

          {summary && (
            <div className="flex items-center gap-3 text-sm">
              {summary.running > 0 && (
                <div className="flex items-center gap-1 text-green-500">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  <span>{summary.running} running</span>
                </div>
              )}
              {summary.waiting > 0 && (
                <div className="flex items-center gap-1 text-yellow-500">
                  <AlertCircle className="h-3 w-3" />
                  <span>{summary.waiting} waiting</span>
                </div>
              )}
              {summary.completed > 0 && (
                <div className="flex items-center gap-1 text-green-500">
                  <CheckCircle className="h-3 w-3" />
                  <span>{summary.completed} done</span>
                </div>
              )}
              {summary.failed > 0 && (
                <div className="flex items-center gap-1 text-red-500">
                  <XCircle className="h-3 w-3" />
                  <span>{summary.failed} failed</span>
                </div>
              )}
            </div>
          )}
        </div>

        <Button
          variant="ghost"
          size="icon-sm"
          onClick={refresh}
          disabled={refreshing}
        >
          <RefreshCw className={cn("h-4 w-4", refreshing && "animate-spin")} />
        </Button>
      </div>

      {/* Workers grid */}
      <div className="flex-1 overflow-auto p-4">
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {workers.map((worker) => (
            <WorkerCard
              key={worker.id}
              worker={worker}
              isExpanded={expandedWorkers.has(worker.id)}
              output={workerOutputs[worker.id]}
              onToggleExpand={() => toggleExpand(worker.id)}
              onViewOutput={() => {
                toggleExpand(worker.id);
                fetchWorkerOutput(worker.id);
              }}
              onSendMessage={(msg) => handleSendMessage(worker.id, msg)}
              onKill={() => handleKillWorker(worker.id)}
              onAttach={
                onAttachToWorker ? () => onAttachToWorker(worker.id) : undefined
              }
            />
          ))}
        </div>
      </div>
    </div>
  );
}

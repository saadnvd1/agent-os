"use client";

import { useState } from "react";
import {
  Play,
  Square,
  RefreshCw,
  FileText,
  Trash2,
  Copy,
  Check,
  Server,
  Container,
  X,
  ExternalLink,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { DevServer, DevServerStatus } from "@/lib/db";

interface DevServerCardProps {
  server: DevServer;
  projectName?: string;
  onStart: (id: string) => Promise<void>;
  onStop: (id: string) => Promise<void>;
  onRestart: (id: string) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
  onViewLogs: (id: string) => void;
}

const statusConfig: Record<
  DevServerStatus,
  { color: string; bgColor: string; label: string }
> = {
  running: { color: "bg-green-500", bgColor: "bg-green-500/10", label: "Running" },
  stopped: { color: "bg-zinc-500", bgColor: "bg-zinc-500/10", label: "Stopped" },
  starting: { color: "bg-yellow-500", bgColor: "bg-yellow-500/10", label: "Starting" },
  failed: { color: "bg-red-500", bgColor: "bg-red-500/10", label: "Failed" },
};

export function DevServerCard({
  server,
  projectName,
  onStart,
  onStop,
  onRestart,
  onRemove,
  onViewLogs,
}: DevServerCardProps) {
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [confirmingStop, setConfirmingStop] = useState(false);

  const status = statusConfig[server.status] || statusConfig.stopped;
  const ports: number[] = JSON.parse(server.ports || "[]");
  const primaryPort = ports[0];
  const isRunning = server.status === "running";
  const isStopped = server.status === "stopped";
  const isFailed = server.status === "failed";

  const handleAction = async (action: () => Promise<void>) => {
    setLoading(true);
    try {
      await action();
    } finally {
      setLoading(false);
    }
  };

  const copyPort = () => {
    if (primaryPort) {
      navigator.clipboard.writeText(`localhost:${primaryPort}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };

  return (
    <div
      className={cn(
        "rounded-lg border border-border/50 p-3",
        "bg-card/50 hover:bg-card/80 transition-colors"
      )}
    >
      {/* Header row */}
      <div className="flex items-center gap-2">
        {/* Status dot */}
        <div className={cn("h-2 w-2 rounded-full", status.color)} />

        {/* Name */}
        <span className="flex-1 truncate text-sm font-medium">{server.name}</span>

        {/* Type badge */}
        <span
          className={cn(
            "flex items-center gap-1 rounded px-1.5 py-0.5",
            "text-[10px] font-medium text-muted-foreground",
            "bg-muted/50"
          )}
        >
          {server.type === "docker" ? (
            <Container className="h-3 w-3" />
          ) : (
            <Server className="h-3 w-3" />
          )}
          {server.type === "docker" ? "Docker" : "Node"}
        </span>
      </div>

      {/* Project name (if provided) */}
      {projectName && (
        <div className="mt-1 text-xs text-muted-foreground truncate">{projectName}</div>
      )}

      {/* Port badge */}
      {primaryPort && (
        <div className="mt-2 flex items-center gap-1">
          {isRunning ? (
            <a
              href={`http://localhost:${primaryPort}`}
              target="_blank"
              rel="noopener noreferrer"
              className={cn(
                "flex items-center gap-1 rounded px-2 py-1",
                "text-xs font-mono transition-colors",
                "bg-primary/10 text-primary hover:bg-primary/20"
              )}
            >
              <ExternalLink className="h-3 w-3" />
              localhost:{primaryPort}
            </a>
          ) : (
            <span
              className={cn(
                "flex items-center gap-1 rounded px-2 py-1",
                "text-xs font-mono",
                "bg-muted/30 text-muted-foreground"
              )}
            >
              localhost:{primaryPort}
            </span>
          )}
          <button
            onClick={copyPort}
            disabled={!isRunning}
            className={cn(
              "flex items-center justify-center rounded p-1",
              "text-xs transition-colors",
              isRunning
                ? "text-muted-foreground hover:text-foreground hover:bg-muted"
                : "text-muted-foreground/50 cursor-not-allowed"
            )}
            title="Copy URL"
          >
            {copied ? (
              <Check className="h-3 w-3 text-green-500" />
            ) : (
              <Copy className="h-3 w-3" />
            )}
          </button>
        </div>
      )}

      {/* Actions */}
      <div className="mt-3 flex items-center gap-1">
        {isRunning && (
          <>
            {confirmingStop ? (
              <>
                <ActionButton
                  icon={Square}
                  label="Confirm"
                  onClick={() => {
                    setConfirmingStop(false);
                    handleAction(() => onStop(server.id));
                  }}
                  disabled={loading}
                  variant="danger"
                />
                <ActionButton
                  icon={X}
                  label="Cancel"
                  onClick={() => setConfirmingStop(false)}
                  disabled={loading}
                />
              </>
            ) : (
              <>
                <ActionButton
                  icon={Square}
                  label="Stop"
                  onClick={() => setConfirmingStop(true)}
                  disabled={loading}
                  variant="danger"
                />
                <ActionButton
                  icon={RefreshCw}
                  label="Restart"
                  onClick={() => handleAction(() => onRestart(server.id))}
                  disabled={loading}
                />
                <ActionButton
                  icon={FileText}
                  label="Logs"
                  onClick={() => onViewLogs(server.id)}
                  disabled={loading}
                />
              </>
            )}
          </>
        )}

        {isStopped && (
          <>
            <ActionButton
              icon={Play}
              label="Start"
              onClick={() => handleAction(() => onStart(server.id))}
              disabled={loading}
              variant="primary"
            />
            <ActionButton
              icon={Trash2}
              label="Remove"
              onClick={() => handleAction(() => onRemove(server.id))}
              disabled={loading}
              variant="danger"
            />
          </>
        )}

        {isFailed && (
          <>
            <ActionButton
              icon={Play}
              label="Start"
              onClick={() => handleAction(() => onStart(server.id))}
              disabled={loading}
              variant="primary"
            />
            <ActionButton
              icon={FileText}
              label="Logs"
              onClick={() => onViewLogs(server.id)}
              disabled={loading}
            />
            <ActionButton
              icon={Trash2}
              label="Remove"
              onClick={() => handleAction(() => onRemove(server.id))}
              disabled={loading}
              variant="danger"
            />
          </>
        )}

        {server.status === "starting" && (
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <RefreshCw className="h-3 w-3 animate-spin" />
            Starting...
          </span>
        )}
      </div>
    </div>
  );
}

interface ActionButtonProps {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  variant?: "default" | "primary" | "danger";
}

function ActionButton({
  icon: Icon,
  label,
  onClick,
  disabled,
  variant = "default",
}: ActionButtonProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={label}
      className={cn(
        "flex h-8 items-center gap-1.5 rounded-md px-2",
        "text-xs font-medium transition-colors",
        "disabled:opacity-50 disabled:cursor-not-allowed",
        variant === "primary" && "bg-primary/10 text-primary hover:bg-primary/20",
        variant === "danger" && "bg-red-500/10 text-red-500 hover:bg-red-500/20",
        variant === "default" && "bg-muted/50 text-foreground hover:bg-muted"
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}

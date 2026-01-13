"use client";

import { useState, useEffect } from "react";
import { X, Server, Container, Loader2, Play, FolderOpen } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Session, ProjectDevServer } from "@/lib/db";

interface DetectedServer {
  type: "node" | "docker";
  name: string;
  command: string;
  ports: number[];
}

interface StartServerDialogProps {
  session: Session;
  projectDevServers?: ProjectDevServer[];
  onStart: (opts: {
    sessionId: string;
    type: "node" | "docker";
    name: string;
    command: string;
    workingDirectory: string;
    ports?: number[];
  }) => Promise<void>;
  onClose: () => void;
}

export function StartServerDialog({
  session,
  projectDevServers = [],
  onStart,
  onClose,
}: StartServerDialogProps) {
  const [detected, setDetected] = useState<DetectedServer[]>([]);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Custom server form state
  const [showCustom, setShowCustom] = useState(false);
  const [customType, setCustomType] = useState<"node" | "docker">("node");
  const [customName, setCustomName] = useState("");
  const [customCommand, setCustomCommand] = useState("");
  const [customPort, setCustomPort] = useState("3000");

  // Detect available servers
  useEffect(() => {
    async function detect() {
      try {
        const res = await fetch(`/api/dev-servers/detect?sessionId=${session.id}`);
        if (res.ok) {
          const data = await res.json();
          setDetected(data.servers || []);
        }
      } catch (err) {
        console.error("Failed to detect servers:", err);
      } finally {
        setLoading(false);
      }
    }
    detect();
  }, [session.id]);

  const handleStartProjectServer = async (server: ProjectDevServer) => {
    setStarting(true);
    setError(null);
    try {
      await onStart({
        sessionId: session.id,
        type: server.type,
        name: server.name,
        command: server.command,
        workingDirectory: session.worktree_path || session.working_directory,
        ports: server.port ? [server.port] : undefined,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start server");
    } finally {
      setStarting(false);
    }
  };

  const handleStartDetected = async (server: DetectedServer) => {
    setStarting(true);
    setError(null);
    try {
      await onStart({
        sessionId: session.id,
        type: server.type,
        name: server.name,
        command: server.command,
        workingDirectory: session.worktree_path || session.working_directory,
        ports: server.ports,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start server");
    } finally {
      setStarting(false);
    }
  };

  const handleStartCustom = async () => {
    if (!customName || !customCommand) {
      setError("Name and command are required");
      return;
    }

    setStarting(true);
    setError(null);
    try {
      const port = parseInt(customPort, 10);
      await onStart({
        sessionId: session.id,
        type: customType,
        name: customName,
        command: customCommand,
        workingDirectory: session.worktree_path || session.working_directory,
        ports: isNaN(port) ? undefined : [port],
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start server");
    } finally {
      setStarting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div
        className={cn(
          "w-full max-w-md rounded-xl",
          "bg-background border border-border",
          "shadow-2xl"
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-lg font-semibold">Start Dev Server</h2>
          <button
            onClick={onClose}
            className="rounded-md p-1 hover:bg-muted transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-4">
          {/* Session info */}
          <div className="text-sm text-muted-foreground">
            For: <span className="font-medium text-foreground">{session.name}</span>
          </div>

          {/* Project dev servers */}
          {projectDevServers.length > 0 && (
            <div className="space-y-2">
              <div className="text-sm font-medium flex items-center gap-2">
                <FolderOpen className="h-4 w-4" />
                Project servers
              </div>
              {projectDevServers.map((server) => (
                <button
                  key={server.id}
                  onClick={() => handleStartProjectServer(server)}
                  disabled={starting}
                  className={cn(
                    "w-full flex items-center gap-3 rounded-lg border border-primary/30 bg-primary/5 p-3",
                    "hover:bg-primary/10 transition-colors text-left",
                    "disabled:opacity-50 disabled:cursor-not-allowed"
                  )}
                >
                  {server.type === "docker" ? (
                    <Container className="h-5 w-5 text-blue-500" />
                  ) : (
                    <Server className="h-5 w-5 text-green-500" />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{server.name}</div>
                    <div className="text-xs text-muted-foreground truncate">
                      {server.command}
                      {server.port && ` (port ${server.port})`}
                    </div>
                  </div>
                  <Play className="h-4 w-4 text-primary" />
                </button>
              ))}
            </div>
          )}

          {/* Detected servers */}
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              <span className="ml-2 text-sm text-muted-foreground">
                Detecting dev servers...
              </span>
            </div>
          ) : detected.length > 0 ? (
            <div className="space-y-2">
              <div className="text-sm font-medium">Detected servers</div>
              {detected.map((server, i) => (
                <button
                  key={i}
                  onClick={() => handleStartDetected(server)}
                  disabled={starting}
                  className={cn(
                    "w-full flex items-center gap-3 rounded-lg border border-border p-3",
                    "hover:bg-muted/50 transition-colors text-left",
                    "disabled:opacity-50 disabled:cursor-not-allowed"
                  )}
                >
                  {server.type === "docker" ? (
                    <Container className="h-5 w-5 text-blue-500" />
                  ) : (
                    <Server className="h-5 w-5 text-green-500" />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{server.name}</div>
                    <div className="text-xs text-muted-foreground truncate">
                      {server.command}
                      {server.ports.length > 0 && ` (port ${server.ports[0]})`}
                    </div>
                  </div>
                  <Play className="h-4 w-4 text-primary" />
                </button>
              ))}
            </div>
          ) : (
            <div className="text-sm text-muted-foreground text-center py-4">
              No dev servers detected automatically
            </div>
          )}

          {/* Custom server form toggle */}
          {!showCustom ? (
            <button
              onClick={() => setShowCustom(true)}
              className="w-full text-sm text-primary hover:underline"
            >
              + Add custom server
            </button>
          ) : (
            <div className="space-y-3 border-t border-border pt-4">
              <div className="text-sm font-medium">Custom server</div>

              {/* Type selector */}
              <div className="flex gap-2">
                <button
                  onClick={() => setCustomType("node")}
                  className={cn(
                    "flex-1 flex items-center justify-center gap-2 rounded-md py-2",
                    "border transition-colors",
                    customType === "node"
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border hover:bg-muted"
                  )}
                >
                  <Server className="h-4 w-4" />
                  Node.js
                </button>
                <button
                  onClick={() => setCustomType("docker")}
                  className={cn(
                    "flex-1 flex items-center justify-center gap-2 rounded-md py-2",
                    "border transition-colors",
                    customType === "docker"
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border hover:bg-muted"
                  )}
                >
                  <Container className="h-4 w-4" />
                  Docker
                </button>
              </div>

              {/* Name input */}
              <input
                type="text"
                placeholder="Server name"
                value={customName}
                onChange={(e) => setCustomName(e.target.value)}
                className={cn(
                  "w-full rounded-md border border-border bg-background px-3 py-2",
                  "text-sm placeholder:text-muted-foreground",
                  "focus:outline-none focus:ring-2 focus:ring-primary/50"
                )}
              />

              {/* Command input */}
              <input
                type="text"
                placeholder={
                  customType === "docker"
                    ? "Service name (e.g., web)"
                    : "Command (e.g., npm run dev)"
                }
                value={customCommand}
                onChange={(e) => setCustomCommand(e.target.value)}
                className={cn(
                  "w-full rounded-md border border-border bg-background px-3 py-2",
                  "text-sm font-mono placeholder:text-muted-foreground",
                  "focus:outline-none focus:ring-2 focus:ring-primary/50"
                )}
              />

              {/* Port input (for Node.js only) */}
              {customType === "node" && (
                <input
                  type="text"
                  placeholder="Port (optional)"
                  value={customPort}
                  onChange={(e) => setCustomPort(e.target.value)}
                  className={cn(
                    "w-full rounded-md border border-border bg-background px-3 py-2",
                    "text-sm placeholder:text-muted-foreground",
                    "focus:outline-none focus:ring-2 focus:ring-primary/50"
                  )}
                />
              )}

              {/* Start custom button */}
              <button
                onClick={handleStartCustom}
                disabled={starting || !customName || !customCommand}
                className={cn(
                  "w-full flex items-center justify-center gap-2 rounded-md py-2",
                  "bg-primary text-primary-foreground font-medium",
                  "hover:bg-primary/90 transition-colors",
                  "disabled:opacity-50 disabled:cursor-not-allowed"
                )}
              >
                {starting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Play className="h-4 w-4" />
                )}
                Start Server
              </button>
            </div>
          )}

          {/* Error message */}
          {error && (
            <div className="text-sm text-red-500 bg-red-500/10 rounded-md p-2">
              {error}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { RefreshCw, Terminal, MonitorUp } from "lucide-react";
import { cn } from "@/lib/utils";

interface TmuxSession {
  name: string;
  windows: number;
  created: string;
  attached: boolean;
}

interface TmuxSessionsProps {
  onAttach: (sessionName: string) => void;
}

export function TmuxSessions({ onAttach }: TmuxSessionsProps) {
  const [sessions, setSessions] = useState<TmuxSession[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchSessions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/exec", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          command:
            "tmux list-sessions -F '#{session_name}|#{session_windows}|#{session_created}|#{session_attached}' 2>/dev/null || echo ''",
        }),
      });
      const data = await res.json();

      if (data.success && data.output.trim()) {
        const parsed = data.output
          .trim()
          .split("\n")
          .filter((line: string) => line.includes("|"))
          .map((line: string) => {
            const [name, windows, created, attached] = line.split("|");
            return {
              name,
              windows: parseInt(windows),
              created: new Date(parseInt(created) * 1000).toLocaleString(),
              attached: attached === "1",
            };
          });
        setSessions(parsed);
      } else {
        setSessions([]);
      }
    } catch (err) {
      console.error("Failed to fetch tmux sessions:", err);
      setError("Failed to load");
      setSessions([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSessions();
    // Refresh every 30 seconds
    const interval = setInterval(fetchSessions, 30000);
    return () => clearInterval(interval);
  }, [fetchSessions]);

  if (sessions.length === 0 && !loading && !error) {
    return null; // Don't show section if no tmux sessions
  }

  return (
    <div className="border-b border-border">
      <div className="flex items-center justify-between px-4 py-2">
        <div className="flex items-center gap-2">
          <Terminal className="w-4 h-4 text-muted-foreground" />
          <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Tmux Sessions
          </span>
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={fetchSessions}
          disabled={loading}
          className="h-6 w-6"
        >
          <RefreshCw className={cn("w-3 h-3", loading && "animate-spin")} />
        </Button>
      </div>

      <div className="px-4 pb-3 space-y-1">
        {error && (
          <p className="text-xs text-destructive">{error}</p>
        )}
        {sessions.map((session) => (
          <button
            key={session.name}
            onClick={() => onAttach(session.name)}
            className={cn(
              "w-full flex items-center justify-between p-2 rounded-md text-left transition-colors",
              "hover:bg-primary/10 border",
              session.attached
                ? "border-primary/50 bg-primary/5"
                : "border-transparent"
            )}
          >
            <div className="flex items-center gap-2 min-w-0">
              <MonitorUp className="w-4 h-4 text-primary flex-shrink-0" />
              <span className="text-sm font-medium truncate">
                {session.name}
              </span>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <span className="text-xs text-muted-foreground">
                {session.windows}w
              </span>
              {session.attached && (
                <Badge variant="success" className="text-[10px] px-1 py-0">
                  attached
                </Badge>
              )}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

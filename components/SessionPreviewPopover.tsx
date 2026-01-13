'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { Terminal as TerminalIcon, Clock, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Session } from '@/lib/db';

interface SessionPreviewPopoverProps {
  session: Session | null;
  status?: 'idle' | 'running' | 'waiting' | 'error' | 'dead';
  position: { x: number; y: number };
}

interface TerminalSnapshot {
  lines: string[];
  timestamp: number;
}

const statusColors: Record<string, string> = {
  running: 'text-blue-400 bg-blue-500/20',
  waiting: 'text-yellow-400 bg-yellow-500/20',
  idle: 'text-gray-400 bg-gray-500/20',
  dead: 'text-red-400 bg-red-500/20',
  error: 'text-red-400 bg-red-500/20',
};

const statusLabels: Record<string, string> = {
  running: 'Working',
  waiting: 'Waiting',
  idle: 'Idle',
  dead: 'Dead',
  error: 'Error',
};

const REFRESH_INTERVAL = 2000;

export function SessionPreviewPopover({ session, status = 'idle', position }: SessionPreviewPopoverProps) {
  const [snapshot, setSnapshot] = useState<TerminalSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const fetchTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const refreshIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const hasSnapshotRef = useRef(false);

  const fetchPreview = useCallback(
    async (sessionId: string, isRefresh = false) => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }

      const controller = new AbortController();
      abortControllerRef.current = controller;

      if (isRefresh) {
        setIsRefreshing(true);
      } else {
        setLoading(true);
      }

      try {
        const response = await fetch(`/api/sessions/${sessionId}/preview`, {
          signal: controller.signal,
        });

        if (response.ok) {
          const data = await response.json();
          setSnapshot({
            lines: data.lines || [],
            timestamp: Date.now(),
          });
          hasSnapshotRef.current = true;
        }
      } catch (err) {
        if (err instanceof Error && err.name !== 'AbortError' && !hasSnapshotRef.current) {
          // Keep existing snapshot if we have one
        }
      } finally {
        setLoading(false);
        setIsRefreshing(false);
      }
    },
    []
  );

  useEffect(() => {
    if (!session) {
      setSnapshot(null);
      hasSnapshotRef.current = false;
      if (fetchTimeoutRef.current) clearTimeout(fetchTimeoutRef.current);
      if (refreshIntervalRef.current) clearInterval(refreshIntervalRef.current);
      if (abortControllerRef.current) abortControllerRef.current.abort();
      return;
    }

    if (fetchTimeoutRef.current) clearTimeout(fetchTimeoutRef.current);

    fetchTimeoutRef.current = setTimeout(() => {
      fetchPreview(session.id, false);

      if (refreshIntervalRef.current) clearInterval(refreshIntervalRef.current);

      refreshIntervalRef.current = setInterval(() => {
        fetchPreview(session.id, true);
      }, REFRESH_INTERVAL);
    }, 100);

    return () => {
      if (fetchTimeoutRef.current) clearTimeout(fetchTimeoutRef.current);
      if (refreshIntervalRef.current) clearInterval(refreshIntervalRef.current);
      if (abortControllerRef.current) abortControllerRef.current.abort();
    };
  }, [session, fetchPreview]);

  if (!session) return null;

  const label = statusLabels[status] || status;

  // Format relative time
  const formatRelativeTime = (date: Date | string) => {
    const now = new Date();
    const then = new Date(date);
    const seconds = Math.floor((now.getTime() - then.getTime()) / 1000);

    if (seconds < 60) return 'just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    return `${Math.floor(seconds / 86400)}d ago`;
  };

  return (
    <div
      style={{
        position: 'fixed',
        left: position.x + 16,
        top: Math.max(16, Math.min(position.y - 200, typeof window !== 'undefined' ? window.innerHeight - 720 : 400)),
        zIndex: 100,
      }}
      className="pointer-events-none animate-in fade-in slide-in-from-left-2 duration-150"
    >
      <div
        className={cn(
          'w-[720px] overflow-hidden rounded-xl',
          'bg-zinc-900/95 backdrop-blur-xl',
          'border border-zinc-700/50',
          'shadow-2xl shadow-black/50'
        )}
      >
        {/* Header */}
        <div className="border-b border-zinc-800 bg-zinc-800/50 px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <TerminalIcon className="h-4 w-4 text-zinc-400" />
              <span className="text-sm font-medium text-zinc-100 truncate max-w-[280px]">
                {session.name}
              </span>
            </div>
            <div className="flex items-center gap-2">
              {isRefreshing && <RefreshCw className="h-3 w-3 animate-spin text-zinc-500" />}
              <span
                className={cn(
                  'rounded-full px-2 py-0.5 text-xs font-medium',
                  statusColors[status]
                )}
              >
                {label}
              </span>
            </div>
          </div>
          <div className="mt-2 flex items-center gap-3 text-xs text-zinc-500">
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {formatRelativeTime(session.created_at)}
            </span>
            {session.working_directory && (
              <span className="truncate max-w-[250px]">
                {session.working_directory.split('/').pop()}
              </span>
            )}
          </div>
        </div>

        {/* Terminal Preview */}
        <div className="p-2">
          <div
            className={cn(
              'h-[480px] rounded-lg',
              'bg-zinc-950 font-mono text-[13px] leading-relaxed',
              'overflow-auto p-3',
              'border border-zinc-800'
            )}
          >
            {loading ? (
              <div className="flex h-full items-center justify-center">
                <div className="flex items-center gap-2 text-zinc-500">
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-zinc-700 border-t-primary" />
                  <span>Loading preview...</span>
                </div>
              </div>
            ) : snapshot?.lines.length ? (
              <div className="space-y-0.5">
                {snapshot.lines.map((line, i) => (
                  <div
                    key={i}
                    className="whitespace-pre text-zinc-300"
                    dangerouslySetInnerHTML={{
                      __html: parseAnsiToHtml(line),
                    }}
                  />
                ))}
              </div>
            ) : (
              <div className="flex h-full items-center justify-center text-zinc-500">
                <span>No output yet</span>
              </div>
            )}
          </div>
        </div>

        {/* Footer hint */}
        <div className="border-t border-zinc-800 bg-zinc-800/30 px-4 py-2">
          <div className="text-xs text-zinc-500">
            Click to connect
          </div>
        </div>
      </div>
    </div>
  );
}

// ANSI to HTML parser for terminal colors
function parseAnsiToHtml(text: string): string {
  const colorMap: Record<string, string> = {
    '0': '',
    '1': 'font-weight: bold',
    '2': 'opacity: 0.7',
    '3': 'font-style: italic',
    '4': 'text-decoration: underline',
    '30': 'color: #3f3f46',
    '31': 'color: #f87171',
    '32': 'color: #4ade80',
    '33': 'color: #fbbf24',
    '34': 'color: #60a5fa',
    '35': 'color: #c084fc',
    '36': 'color: #22d3ee',
    '37': 'color: #e4e4e7',
    '90': 'color: #71717a',
    '91': 'color: #fca5a5',
    '92': 'color: #86efac',
    '93': 'color: #fde047',
    '94': 'color: #93c5fd',
    '95': 'color: #d8b4fe',
    '96': 'color: #67e8f9',
    '97': 'color: #fafafa',
  };

  let result = text.replace(/</g, '&lt;').replace(/>/g, '&gt;');

  // eslint-disable-next-line no-control-regex
  result = result.replace(/\x1b\[([0-9;]+)m/g, (_, codes) => {
    const codeList = codes.split(';');

    if (codeList.includes('0')) {
      return '</span>';
    }

    const styles: string[] = [];
    for (const code of codeList) {
      if (colorMap[code]) {
        styles.push(colorMap[code]);
      }
    }

    if (styles.length > 0) {
      return `<span style="${styles.join('; ')}">`;
    }
    return '';
  });

  // eslint-disable-next-line no-control-regex
  result = result.replace(/\x1b\[0m/g, '</span>');

  return result;
}

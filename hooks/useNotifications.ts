"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { toast } from "sonner";
import {
  NotificationSettings,
  NotificationEvent,
  defaultSettings,
  loadSettings,
  saveSettings,
  requestNotificationPermission,
  canSendBrowserNotification,
  sendBrowserNotification,
  playNotificationSound,
  setTabNotificationCount,
  flashTabTitle,
  clearTabNotifications,
} from "@/lib/notifications";

type SessionStatus = "idle" | "running" | "waiting" | "error" | "dead";

interface SessionState {
  id: string;
  name: string;
  status: SessionStatus;
}

interface UseNotificationsOptions {
  onSessionClick?: (sessionId: string) => void;
}

export function useNotifications(options: UseNotificationsOptions = {}) {
  const { onSessionClick } = options;
  const [settings, setSettings] =
    useState<NotificationSettings>(defaultSettings);
  const [permissionGranted, setPermissionGranted] = useState(false);
  const previousStates = useRef<Map<string, SessionStatus>>(new Map());
  const waitingCount = useRef(0);
  // Track which sessions have been notified to prevent duplicates
  const notifiedSessions = useRef<Set<string>>(new Set());

  // Load settings on mount
  useEffect(() => {
    setSettings(loadSettings());
    setPermissionGranted(canSendBrowserNotification());
  }, []);

  // Request permission
  const requestPermission = useCallback(async () => {
    const granted = await requestNotificationPermission();
    setPermissionGranted(granted);
    return granted;
  }, []);

  // Update settings
  const updateSettings = useCallback(
    (newSettings: Partial<NotificationSettings>) => {
      setSettings((prev) => {
        const updated = { ...prev, ...newSettings };
        saveSettings(updated);
        return updated;
      });
    },
    []
  );

  // Toggle a specific event
  const toggleEvent = useCallback(
    (event: NotificationEvent, enabled: boolean) => {
      setSettings((prev) => {
        const updated = {
          ...prev,
          events: { ...prev.events, [event]: enabled },
        };
        saveSettings(updated);
        return updated;
      });
    },
    []
  );

  // Send notification for an event
  const notify = useCallback(
    (
      event: NotificationEvent,
      sessionId: string,
      sessionName: string,
      message?: string
    ) => {
      if (!settings.enabled || !settings.events[event]) return;

      const titles: Record<NotificationEvent, string> = {
        waiting: `${sessionName} needs input`,
        error: `${sessionName} encountered an error`,
        completed: `${sessionName} completed`,
      };

      const title = titles[event];
      const body = message || getDefaultMessage(event);

      // In-app toast with click action
      const toastTypes: Record<
        NotificationEvent,
        "warning" | "error" | "success"
      > = {
        waiting: "warning",
        error: "error",
        completed: "success",
      };
      toast[toastTypes[event]](title, {
        description: body,
        action: {
          label: "Go to session",
          onClick: () => onSessionClick?.(sessionId),
        },
      });

      // Browser notification (only if page not focused)
      if (settings.browserNotifications && permissionGranted) {
        sendBrowserNotification(
          title,
          { body, tag: `agentos-${event}-${sessionName}` },
          () => onSessionClick?.(sessionId)
        );
      }

      // Sound
      if (settings.sound) {
        playNotificationSound(event);
      }

      // Flash tab title
      if (event === "waiting") {
        flashTabTitle(`Waiting: ${sessionName}`);
      }
    },
    [settings, permissionGranted, onSessionClick]
  );

  // Check for state changes and notify
  const checkStateChanges = useCallback(
    (sessions: SessionState[], activeSessionId?: string | null) => {
      if (!settings.enabled) return;

      let newWaitingCount = 0;

      sessions.forEach((session) => {
        const prevStatus = previousStates.current.get(session.id);
        const currentStatus = session.status;

        // Track waiting count
        if (currentStatus === "waiting") {
          newWaitingCount++;
        }

        // Skip if no previous state (initial load)
        if (prevStatus === undefined) {
          previousStates.current.set(session.id, currentStatus);
          return;
        }

        // Skip if status unchanged
        if (prevStatus === currentStatus) return;

        // Skip notifications for the currently active/focused session
        if (session.id === activeSessionId) {
          previousStates.current.set(session.id, currentStatus);
          return;
        }

        // Detect transitions and notify (with deduplication)
        const notifyKey = `${session.id}-${currentStatus}`;

        if (currentStatus === "waiting" && prevStatus !== "waiting") {
          if (!notifiedSessions.current.has(notifyKey)) {
            notifiedSessions.current.add(notifyKey);
            notify("waiting", session.id, session.name);
          }
        } else if (currentStatus === "error" && prevStatus !== "error") {
          if (!notifiedSessions.current.has(notifyKey)) {
            notifiedSessions.current.add(notifyKey);
            notify("error", session.id, session.name);
          }
        } else if (
          currentStatus === "idle" &&
          (prevStatus === "running" || prevStatus === "waiting")
        ) {
          const completedKey = `${session.id}-completed`;
          if (!notifiedSessions.current.has(completedKey)) {
            notifiedSessions.current.add(completedKey);
            notify("completed", session.id, session.name);
          }
        }

        // Clear notification tracking when status changes away from notified state
        if (prevStatus !== currentStatus) {
          notifiedSessions.current.delete(`${session.id}-${prevStatus}`);
          if (prevStatus === "idle") {
            notifiedSessions.current.delete(`${session.id}-completed`);
          }
        }

        previousStates.current.set(session.id, currentStatus);
      });

      // Update tab badge
      if (newWaitingCount !== waitingCount.current) {
        waitingCount.current = newWaitingCount;
        setTabNotificationCount(newWaitingCount);
      }
    },
    [settings.enabled, notify]
  );

  // Clear notifications when focused
  useEffect(() => {
    const handleFocus = () => {
      // Don't clear count, just stop flashing
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        // User returned to tab
      }
    };

    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      clearTabNotifications();
    };
  }, []);

  return {
    settings,
    permissionGranted,
    requestPermission,
    updateSettings,
    toggleEvent,
    notify,
    checkStateChanges,
  };
}

function getDefaultMessage(event: NotificationEvent): string {
  switch (event) {
    case "waiting":
      return "Session is waiting for your input";
    case "error":
      return "Something went wrong";
    case "completed":
      return "Task has finished";
  }
}

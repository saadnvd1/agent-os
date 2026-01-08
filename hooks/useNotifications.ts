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

export function useNotifications() {
  const [settings, setSettings] = useState<NotificationSettings>(defaultSettings);
  const [permissionGranted, setPermissionGranted] = useState(false);
  const previousStates = useRef<Map<string, SessionStatus>>(new Map());
  const waitingCount = useRef(0);

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
  const updateSettings = useCallback((newSettings: Partial<NotificationSettings>) => {
    setSettings((prev) => {
      const updated = { ...prev, ...newSettings };
      saveSettings(updated);
      return updated;
    });
  }, []);

  // Toggle a specific event
  const toggleEvent = useCallback((event: NotificationEvent, enabled: boolean) => {
    setSettings((prev) => {
      const updated = {
        ...prev,
        events: { ...prev.events, [event]: enabled },
      };
      saveSettings(updated);
      return updated;
    });
  }, []);

  // Send notification for an event
  const notify = useCallback(
    (event: NotificationEvent, sessionName: string, message?: string) => {
      if (!settings.enabled || !settings.events[event]) return;

      const titles: Record<NotificationEvent, string> = {
        waiting: `${sessionName} needs input`,
        error: `${sessionName} encountered an error`,
        completed: `${sessionName} completed`,
      };

      const title = titles[event];
      const body = message || getDefaultMessage(event);

      // In-app toast
      const toastTypes: Record<NotificationEvent, "warning" | "error" | "success"> = {
        waiting: "warning",
        error: "error",
        completed: "success",
      };
      toast[toastTypes[event]](title, { description: body });

      // Browser notification (only if page not focused)
      if (settings.browserNotifications && permissionGranted) {
        sendBrowserNotification(title, { body, tag: `agentos-${event}-${sessionName}` });
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
    [settings, permissionGranted]
  );

  // Check for state changes and notify
  const checkStateChanges = useCallback(
    (sessions: SessionState[]) => {
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

        // Detect transitions
        if (currentStatus === "waiting" && prevStatus !== "waiting") {
          notify("waiting", session.name);
        } else if (currentStatus === "error" && prevStatus !== "error") {
          notify("error", session.name);
        } else if (
          currentStatus === "idle" &&
          (prevStatus === "running" || prevStatus === "waiting")
        ) {
          notify("completed", session.name);
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

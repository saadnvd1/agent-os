// Notification utilities for AgentOS

export type NotificationEvent = "waiting" | "error" | "completed";

export interface NotificationSettings {
  enabled: boolean;
  browserNotifications: boolean;
  sound: boolean;
  events: {
    waiting: boolean;
    error: boolean;
    completed: boolean;
  };
}

export const defaultSettings: NotificationSettings = {
  enabled: true,
  browserNotifications: true,
  sound: true,
  events: {
    waiting: true,
    error: true,
    completed: false, // Off by default - can be noisy
  },
};

const SETTINGS_KEY = "agentosNotificationSettings";

export function loadSettings(): NotificationSettings {
  if (typeof window === "undefined") return defaultSettings;
  try {
    const stored = localStorage.getItem(SETTINGS_KEY);
    if (stored) {
      return { ...defaultSettings, ...JSON.parse(stored) };
    }
  } catch {
    // Ignore parse errors
  }
  return defaultSettings;
}

export function saveSettings(settings: NotificationSettings): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

export async function requestNotificationPermission(): Promise<boolean> {
  if (typeof window === "undefined" || !("Notification" in window)) {
    return false;
  }

  if (Notification.permission === "granted") {
    return true;
  }

  if (Notification.permission === "denied") {
    return false;
  }

  const permission = await Notification.requestPermission();
  return permission === "granted";
}

export function canSendBrowserNotification(): boolean {
  if (typeof window === "undefined" || !("Notification" in window)) {
    return false;
  }
  return Notification.permission === "granted";
}

export function sendBrowserNotification(
  title: string,
  options?: NotificationOptions,
  onClick?: () => void
): Notification | null {
  if (!canSendBrowserNotification()) return null;

  // Only send if page is not focused
  if (document.hasFocus()) return null;

  const notification = new Notification(title, {
    icon: "/favicon.ico",
    badge: "/favicon.ico",
    ...options,
  });

  // Auto-close after 5 seconds
  setTimeout(() => notification.close(), 5000);

  // Focus window and trigger callback when clicked
  notification.onclick = () => {
    window.focus();
    notification.close();
    onClick?.();
  };

  return notification;
}

// Audio notification
let audioContext: AudioContext | null = null;

export function playNotificationSound(
  type: NotificationEvent = "waiting"
): void {
  if (typeof window === "undefined") return;

  try {
    if (!audioContext) {
      audioContext = new AudioContext();
    }

    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);

    // Different tones for different events
    const frequencies: Record<NotificationEvent, number[]> = {
      waiting: [800, 600], // Two-tone descending (needs attention)
      error: [300, 200], // Low tones (error)
      completed: [600, 800], // Two-tone ascending (success)
    };

    const freqs = frequencies[type];
    const duration = 0.1;

    gainNode.gain.setValueAtTime(0.1, audioContext.currentTime);

    freqs.forEach((freq, i) => {
      const startTime = audioContext!.currentTime + i * duration;
      oscillator.frequency.setValueAtTime(freq, startTime);
    });

    gainNode.gain.setValueAtTime(0.1, audioContext.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(
      0.01,
      audioContext.currentTime + freqs.length * duration
    );

    oscillator.start(audioContext.currentTime);
    oscillator.stop(audioContext.currentTime + freqs.length * duration);
  } catch {
    // Audio not available
  }
}

// Tab title/badge management
let originalTitle = "";
let notificationCount = 0;
let titleInterval: NodeJS.Timeout | null = null;

export function setTabNotificationCount(count: number): void {
  if (typeof window === "undefined") return;

  if (!originalTitle) {
    originalTitle = document.title.replace(/^\(\d+\)\s*/, "");
  }

  notificationCount = count;

  if (count > 0) {
    document.title = `(${count}) ${originalTitle}`;
  } else {
    document.title = originalTitle;
  }
}

export function flashTabTitle(message: string): void {
  if (typeof window === "undefined") return;

  if (!originalTitle) {
    originalTitle = document.title.replace(/^\(\d+\)\s*/, "");
  }

  // Clear existing flash
  if (titleInterval) {
    clearInterval(titleInterval);
  }

  let showMessage = true;
  titleInterval = setInterval(() => {
    if (document.hasFocus()) {
      // Stop flashing when focused
      if (titleInterval) clearInterval(titleInterval);
      document.title =
        notificationCount > 0
          ? `(${notificationCount}) ${originalTitle}`
          : originalTitle;
      return;
    }

    document.title = showMessage ? message : originalTitle;
    showMessage = !showMessage;
  }, 1000);

  // Stop after 30 seconds
  setTimeout(() => {
    if (titleInterval) {
      clearInterval(titleInterval);
      document.title =
        notificationCount > 0
          ? `(${notificationCount}) ${originalTitle}`
          : originalTitle;
    }
  }, 30000);
}

export function clearTabNotifications(): void {
  if (titleInterval) {
    clearInterval(titleInterval);
    titleInterval = null;
  }
  notificationCount = 0;
  if (originalTitle) {
    document.title = originalTitle;
  }
}

/**
 * Theme configuration for AgentOS
 * UI theme definitions and helper functions
 */

import {
  Moon,
  Sun,
  Monitor,
  Flame,
  Zap,
  CloudMoon,
  Trees,
  Sparkles,
  Waves,
  Coffee,
  type LucideIcon,
} from "lucide-react";

export type ThemeMode = "light" | "dark" | "system";
export type DarkThemeVariant =
  | "deep"
  | "charcoal"
  | "warm"
  | "cool"
  | "gray"
  | "midnight"
  | "forest"
  | "purple"
  | "ocean"
  | "mocha";
export type LightThemeVariant =
  | "default"
  | "warm"
  | "cool"
  | "soft"
  | "rose"
  | "lavender"
  | "mint"
  | "peach";
export type Theme =
  | "light"
  | `light-${LightThemeVariant}`
  | "dark"
  | `dark-${DarkThemeVariant}`
  | "system";

export interface ThemeOption {
  id: DarkThemeVariant | LightThemeVariant;
  label: string;
  description: string;
  icon: LucideIcon;
  preview: {
    background: string;
    foreground: string;
    accent: string;
  };
}

export const DARK_THEMES: ThemeOption[] = [
  {
    id: "deep",
    label: "Deep Black",
    description: "Premium true black",
    icon: Moon,
    preview: {
      background: "#0A0A0A",
      foreground: "#EBEBEB",
      accent: "#3B82F6",
    },
  },
  {
    id: "charcoal",
    label: "Charcoal",
    description: "Soft dark, easy on eyes",
    icon: Moon,
    preview: {
      background: "#161A1D",
      foreground: "#E8EAEB",
      accent: "#5B9BD5",
    },
  },
  {
    id: "warm",
    label: "Warm",
    description: "Cozy browns with amber",
    icon: Flame,
    preview: {
      background: "#1A1612",
      foreground: "#E8DCC8",
      accent: "#F59E0B",
    },
  },
  {
    id: "cool",
    label: "Cool",
    description: "VS Code / GitHub style",
    icon: Zap,
    preview: {
      background: "#0D1117",
      foreground: "#E6EDF3",
      accent: "#58A6FF",
    },
  },
  {
    id: "gray",
    label: "Gray",
    description: "Balanced medium gray",
    icon: Monitor,
    preview: {
      background: "#191919",
      foreground: "#DEDEDE",
      accent: "#2383E2",
    },
  },
  {
    id: "midnight",
    label: "Midnight",
    description: "Deep blue, nordic style",
    icon: CloudMoon,
    preview: {
      background: "#0A0E1A",
      foreground: "#E5E9F0",
      accent: "#88C0D0",
    },
  },
  {
    id: "forest",
    label: "Forest",
    description: "Dark green with emerald",
    icon: Trees,
    preview: {
      background: "#0C1410",
      foreground: "#E8F0ED",
      accent: "#50C878",
    },
  },
  {
    id: "purple",
    label: "Purple",
    description: "Deep purple, creative",
    icon: Sparkles,
    preview: {
      background: "#0F0A1A",
      foreground: "#E8E5F0",
      accent: "#A855F7",
    },
  },
  {
    id: "ocean",
    label: "Ocean",
    description: "Deep teal, serene",
    icon: Waves,
    preview: {
      background: "#0A1419",
      foreground: "#E5EBF0",
      accent: "#14B8A6",
    },
  },
  {
    id: "mocha",
    label: "Mocha",
    description: "Rich brown, sophisticated",
    icon: Coffee,
    preview: {
      background: "#1C1612",
      foreground: "#E6DDD4",
      accent: "#D4844A",
    },
  },
];

export const LIGHT_THEMES: ThemeOption[] = [
  {
    id: "default",
    label: "Default",
    description: "Clean white",
    icon: Sun,
    preview: {
      background: "#FFFFFF",
      foreground: "#111111",
      accent: "#3B82F6",
    },
  },
  {
    id: "warm",
    label: "Warm",
    description: "Soft beige tones",
    icon: Flame,
    preview: {
      background: "#F5F1E8",
      foreground: "#2D2519",
      accent: "#D97706",
    },
  },
  {
    id: "cool",
    label: "Cool",
    description: "Blue-tinted white",
    icon: Zap,
    preview: {
      background: "#F0F4F8",
      foreground: "#1E293B",
      accent: "#0EA5E9",
    },
  },
  {
    id: "soft",
    label: "Soft",
    description: "Gentle gray-white",
    icon: CloudMoon,
    preview: {
      background: "#F8F9FA",
      foreground: "#212529",
      accent: "#6366F1",
    },
  },
  {
    id: "rose",
    label: "Rose",
    description: "Soft pink tones",
    icon: Sparkles,
    preview: {
      background: "#FAF5F7",
      foreground: "#2D1A22",
      accent: "#E74C8C",
    },
  },
  {
    id: "lavender",
    label: "Lavender",
    description: "Gentle purple",
    icon: Sparkles,
    preview: {
      background: "#F7F5FA",
      foreground: "#1F1A2D",
      accent: "#9F7AEA",
    },
  },
  {
    id: "mint",
    label: "Mint",
    description: "Fresh green",
    icon: Trees,
    preview: {
      background: "#F0F9F6",
      foreground: "#14291F",
      accent: "#28B88B",
    },
  },
  {
    id: "peach",
    label: "Peach",
    description: "Warm coral tones",
    icon: Sun,
    preview: {
      background: "#F9F4F0",
      foreground: "#2D1F19",
      accent: "#FA8B6C",
    },
  },
];

/**
 * Parse a theme string into mode and variant
 */
export function parseTheme(theme: string): {
  mode: ThemeMode;
  variant: DarkThemeVariant | LightThemeVariant | null;
} {
  if (theme === "system") {
    return { mode: "system", variant: null };
  }

  if (theme === "light") {
    return { mode: "light", variant: "default" };
  }

  if (theme === "dark") {
    return { mode: "dark", variant: "deep" };
  }

  const [mode, variant] = theme.split("-") as [ThemeMode, string];

  if (mode === "dark") {
    return { mode, variant: (variant as DarkThemeVariant) || "deep" };
  }

  if (mode === "light") {
    return { mode, variant: (variant as LightThemeVariant) || "default" };
  }

  return { mode: "dark", variant: "deep" };
}

/**
 * Build a theme string from mode and variant
 */
export function buildTheme(
  mode: ThemeMode,
  variant: DarkThemeVariant | LightThemeVariant | null
): Theme {
  if (mode === "system") return "system";
  if (!variant || variant === "default" || variant === "deep") return mode;
  return `${mode}-${variant}` as Theme;
}

/**
 * Get all available theme strings for next-themes
 */
export function getAllThemes(): Theme[] {
  const themes: Theme[] = ["system", "light", "dark"];

  for (const lt of LIGHT_THEMES) {
    if (lt.id !== "default") {
      themes.push(`light-${lt.id}` as Theme);
    }
  }

  for (const dt of DARK_THEMES) {
    if (dt.id !== "deep") {
      themes.push(`dark-${dt.id}` as Theme);
    }
  }

  return themes;
}

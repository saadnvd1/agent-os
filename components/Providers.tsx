"use client";

import { useEffect } from "react";
import { ThemeProvider as NextThemesProvider, useTheme } from "next-themes";
import { TooltipProvider } from "@/components/ui/tooltip";
import { parseTheme, getAllThemes } from "@/lib/theme-config";

/**
 * Handles applying theme class and data-theme-variant attribute
 */
function ThemeClassHandler({ children }: { children: React.ReactNode }) {
  const { theme, systemTheme } = useTheme();

  useEffect(() => {
    const root = document.documentElement;

    // Determine the actual theme (handle system theme)
    let actualTheme = theme;
    if (theme === "system") {
      actualTheme = systemTheme || "dark";
    }

    // Parse theme into mode and variant
    const { mode, variant } = parseTheme(actualTheme || "dark");

    // Remove all theme classes and attributes
    root.classList.remove("dark", "light");
    root.removeAttribute("data-theme-variant");

    // Apply theme class (dark or light)
    root.classList.add(mode === "system" ? "dark" : mode);

    // Apply variant as data attribute if present
    // "deep" (dark) and "default" (light) are base themes - no data attribute needed
    if (variant && variant !== "default" && variant !== "deep") {
      root.setAttribute("data-theme-variant", variant);
    }
  }, [theme, systemTheme]);

  return <>{children}</>;
}

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider
      attribute="data-theme"
      defaultTheme="dark"
      enableSystem
      disableTransitionOnChange
      themes={getAllThemes()}
    >
      <ThemeClassHandler>
        <TooltipProvider delayDuration={200}>{children}</TooltipProvider>
      </ThemeClassHandler>
    </NextThemesProvider>
  );
}

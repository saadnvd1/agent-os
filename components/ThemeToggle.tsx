"use client";

import { Moon, Sun, Monitor, Check, Palette } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
  DropdownMenuTrigger,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu";
import {
  DARK_THEMES,
  LIGHT_THEMES,
  parseTheme,
  buildTheme,
  type DarkThemeVariant,
  type LightThemeVariant,
} from "@/lib/theme-config";

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const { mode, variant } = parseTheme(theme || "system");

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="h-8 w-8">
          <Palette className="h-4 w-4" />
          <span className="sr-only">Change theme</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        {/* Light Themes */}
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <Sun className="mr-2 h-4 w-4" />
            <span>Light</span>
            {mode === "light" && (
              <Check className="ml-auto h-4 w-4 text-primary" />
            )}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-56 max-h-[50vh] overflow-y-auto">
            <DropdownMenuLabel className="text-xs text-muted-foreground">
              Choose your light theme
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            {LIGHT_THEMES.map((lightTheme) => {
              const Icon = lightTheme.icon;
              const isActive = mode === "light" && variant === lightTheme.id;
              return (
                <DropdownMenuItem
                  key={lightTheme.id}
                  onClick={() =>
                    setTheme(buildTheme("light", lightTheme.id as LightThemeVariant))
                  }
                  className="cursor-pointer"
                >
                  <Icon className="mr-2 h-4 w-4 flex-shrink-0" />
                  <div className="flex flex-1 flex-col gap-0.5">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">
                        {lightTheme.label}
                      </span>
                      {isActive && <Check className="h-4 w-4 text-primary" />}
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {lightTheme.description}
                    </span>
                    {/* Color preview */}
                    <div className="mt-1 flex gap-1">
                      <div
                        className="h-3 w-8 rounded-sm border border-border/50"
                        style={{ backgroundColor: lightTheme.preview.background }}
                      />
                      <div
                        className="h-3 w-8 rounded-sm border border-border/50"
                        style={{ backgroundColor: lightTheme.preview.accent }}
                      />
                    </div>
                  </div>
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        {/* Dark Themes */}
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <Moon className="mr-2 h-4 w-4" />
            <span>Dark</span>
            {mode === "dark" && (
              <Check className="ml-auto h-4 w-4 text-primary" />
            )}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-56 max-h-[50vh] overflow-y-auto">
            <DropdownMenuLabel className="text-xs text-muted-foreground">
              Choose your dark theme
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            {DARK_THEMES.map((darkTheme) => {
              const Icon = darkTheme.icon;
              const isActive = mode === "dark" && variant === darkTheme.id;
              return (
                <DropdownMenuItem
                  key={darkTheme.id}
                  onClick={() =>
                    setTheme(buildTheme("dark", darkTheme.id as DarkThemeVariant))
                  }
                  className="cursor-pointer"
                >
                  <Icon className="mr-2 h-4 w-4 flex-shrink-0" />
                  <div className="flex flex-1 flex-col gap-0.5">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">
                        {darkTheme.label}
                      </span>
                      {isActive && <Check className="h-4 w-4 text-primary" />}
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {darkTheme.description}
                    </span>
                    {/* Color preview */}
                    <div className="mt-1 flex gap-1">
                      <div
                        className="h-3 w-8 rounded-sm border border-border/50"
                        style={{ backgroundColor: darkTheme.preview.background }}
                      />
                      <div
                        className="h-3 w-8 rounded-sm border border-border/50"
                        style={{ backgroundColor: darkTheme.preview.accent }}
                      />
                    </div>
                  </div>
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        <DropdownMenuSeparator />

        {/* System Theme */}
        <DropdownMenuItem onClick={() => setTheme("system")}>
          <Monitor className="mr-2 h-4 w-4" />
          <span>System</span>
          {mode === "system" && (
            <Check className="ml-auto h-4 w-4 text-primary" />
          )}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

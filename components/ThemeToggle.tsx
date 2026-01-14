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
              <Check className="text-primary ml-auto h-4 w-4" />
            )}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="max-h-[50vh] w-56 overflow-y-auto">
            <DropdownMenuLabel className="text-muted-foreground text-xs">
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
                    setTheme(
                      buildTheme("light", lightTheme.id as LightThemeVariant)
                    )
                  }
                  className="cursor-pointer"
                >
                  <Icon className="mr-2 h-4 w-4 flex-shrink-0" />
                  <div className="flex flex-1 flex-col gap-0.5">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">
                        {lightTheme.label}
                      </span>
                      {isActive && <Check className="text-primary h-4 w-4" />}
                    </div>
                    <span className="text-muted-foreground text-xs">
                      {lightTheme.description}
                    </span>
                    {/* Color preview */}
                    <div className="mt-1 flex gap-1">
                      <div
                        className="border-border/50 h-3 w-8 rounded-sm border"
                        style={{
                          backgroundColor: lightTheme.preview.background,
                        }}
                      />
                      <div
                        className="border-border/50 h-3 w-8 rounded-sm border"
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
              <Check className="text-primary ml-auto h-4 w-4" />
            )}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="max-h-[50vh] w-56 overflow-y-auto">
            <DropdownMenuLabel className="text-muted-foreground text-xs">
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
                    setTheme(
                      buildTheme("dark", darkTheme.id as DarkThemeVariant)
                    )
                  }
                  className="cursor-pointer"
                >
                  <Icon className="mr-2 h-4 w-4 flex-shrink-0" />
                  <div className="flex flex-1 flex-col gap-0.5">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">
                        {darkTheme.label}
                      </span>
                      {isActive && <Check className="text-primary h-4 w-4" />}
                    </div>
                    <span className="text-muted-foreground text-xs">
                      {darkTheme.description}
                    </span>
                    {/* Color preview */}
                    <div className="mt-1 flex gap-1">
                      <div
                        className="border-border/50 h-3 w-8 rounded-sm border"
                        style={{
                          backgroundColor: darkTheme.preview.background,
                        }}
                      />
                      <div
                        className="border-border/50 h-3 w-8 rounded-sm border"
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
            <Check className="text-primary ml-auto h-4 w-4" />
          )}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

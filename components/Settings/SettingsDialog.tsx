"use client";

import { memo } from "react";
import { useSnapshot } from "valtio";
import {
  ArrowLeft,
  Bell,
  ChevronRight,
  Clock,
  GitMerge,
  LayoutGrid,
  Smartphone,
  type LucideIcon,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { DevicesPanel } from "@/components/Devices";
import { GlobalMergeSection } from "@/components/Merge/GlobalMergeSection";
import { SchedulesPanel } from "@/components/Schedules";
import { WorkspaceSettings } from "@/components/Workspaces";
import { useSettingsUrl } from "@/hooks/useSettingsUrl";
import { SETTINGS_SECTIONS, type SettingsSection } from "@/lib/settings-url";
import { cn } from "@/lib/utils";
import { schedulesUiActions } from "@/stores/schedulesUi";
import { settingsUi, settingsUiActions } from "@/stores/settingsUi";
import {
  NotificationsSection,
  type BrowserNotifications,
} from "./NotificationsSection";

export const SECTION_INFO: Record<
  SettingsSection,
  { label: string; hint: string; icon: LucideIcon }
> = {
  merging: {
    label: "Merging",
    hint: "Approval, merge method, branch clean-up",
    icon: GitMerge,
  },
  workspaces: {
    label: "Workspaces",
    hint: "Running task limit",
    icon: LayoutGrid,
  },
  devices: {
    label: "Devices & access",
    hint: "Pairing, passkeys, network",
    icon: Smartphone,
  },
  notifications: {
    label: "Notifications",
    hint: "Sound, browser alerts, your phone",
    icon: Bell,
  },
  schedules: {
    label: "Schedules",
    hint: "Work that starts at set times",
    icon: Clock,
  },
};

function SectionBody({
  section,
  browser,
}: {
  section: SettingsSection;
  browser: BrowserNotifications;
}) {
  switch (section) {
    case "merging":
      return <GlobalMergeSection />;
    case "workspaces":
      return <WorkspaceSettings />;
    case "devices":
      return <DevicesPanel />;
    case "notifications":
      return <NotificationsSection browser={browser} />;
    case "schedules":
      return <SchedulesPanel />;
  }
}

/**
 * Every AgentOS setting, in one place. Wide screens show the sections beside
 * the open one; a phone shows the list, then the section with a way back.
 */
// Memoised: the page re-renders on every status push.
export const SettingsDialog = memo(function SettingsDialog({
  notifications,
}: {
  notifications: BrowserNotifications;
}) {
  const { open, section } = useSnapshot(settingsUi);
  useSettingsUrl();
  // A wide screen always shows a section; a phone shows the list first.
  const shown = section ?? SETTINGS_SECTIONS[0];

  const onOpenChange = (o: boolean) => {
    if (o) return;
    settingsUiActions.close();
    schedulesUiActions.clearDraft();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        // Focus the dialog, not the first section: that may not be the one
        // shown, and its ring would say it was.
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          (e.currentTarget as HTMLElement).focus();
        }}
        className={cn(
          "flex flex-col gap-0 overflow-hidden p-0",
          "md:h-[min(85dvh,760px)] md:max-w-3xl",
          // Full screen on a phone.
          "max-md:inset-0 max-md:h-dvh max-md:max-w-none max-md:translate-x-0 max-md:translate-y-0 max-md:rounded-none"
        )}
      >
        <div className="flex min-h-14 shrink-0 items-center gap-1 border-b px-4 pr-12 md:px-6">
          {section && (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="All settings"
              className="-ml-2 h-11 w-11 md:hidden"
              onClick={() => settingsUiActions.show(null)}
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
          )}
          <DialogTitle className="truncate">
            <span className={cn(section && "max-md:hidden")}>Settings</span>
            {section && (
              <span className="md:hidden">{SECTION_INFO[section].label}</span>
            )}
          </DialogTitle>
          <DialogDescription className="sr-only">
            Every AgentOS setting: merging, workspaces, devices, notifications
            and schedules.
          </DialogDescription>
        </div>

        <div className="flex min-h-0 flex-1">
          <nav
            aria-label="Settings sections"
            className={cn(
              "w-full shrink-0 overflow-y-auto p-2 md:w-56 md:border-r",
              section && "max-md:hidden"
            )}
          >
            <ul className="space-y-0.5">
              {SETTINGS_SECTIONS.map((id) => {
                const { label, hint, icon: Icon } = SECTION_INFO[id];
                const current = id === shown;
                return (
                  <li key={id}>
                    <button
                      type="button"
                      aria-current={current ? "page" : undefined}
                      onClick={() => settingsUiActions.show(id)}
                      className={cn(
                        "hover:bg-muted/60 flex min-h-14 w-full items-center gap-3 rounded-lg px-3 py-2 text-left md:min-h-9 md:py-1.5",
                        current && "md:bg-muted"
                      )}
                    >
                      <Icon className="text-muted-foreground h-4 w-4 shrink-0" />
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium">
                          {label}
                        </span>
                        <span className="text-muted-foreground block truncate text-xs md:hidden">
                          {hint}
                        </span>
                      </span>
                      <ChevronRight className="text-muted-foreground h-4 w-4 shrink-0 md:hidden" />
                    </button>
                  </li>
                );
              })}
            </ul>
          </nav>

          <section
            aria-label={SECTION_INFO[shown].label}
            className={cn(
              "min-w-0 flex-1 overflow-y-auto px-4 py-4 md:px-6",
              !section && "max-md:hidden"
            )}
          >
            <h2 className="mb-4 text-base font-semibold max-md:hidden">
              {SECTION_INFO[shown].label}
            </h2>
            {open && (
              <SectionBody
                key={shown}
                section={shown}
                browser={notifications}
              />
            )}
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
});

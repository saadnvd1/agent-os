import { beforeEach, describe, expect, it } from "vitest";
import { schedulesUi, schedulesUiActions } from "@/stores/schedulesUi";
import { settingsUi, settingsUiActions } from "@/stores/settingsUi";
import { settingsCommands } from "./commands";

const run = (id: string, workspaceId: string | null = null) => {
  const command = settingsCommands(workspaceId).find((c) => c.id === id);
  if (!command) throw new Error(`no command ${id}`);
  command.run();
};

beforeEach(() => {
  settingsUiActions.close();
  settingsUi.section = null;
  schedulesUi.workspaceId = null;
  schedulesUi.draft = null;
});

describe("⌘K entry points", () => {
  it.each([
    ["app.settings", null],
    ["app.merging", "merging"],
    ["app.workspace-settings", "workspaces"],
    ["app.devices", "devices"],
    ["app.notifications", "notifications"],
    ["app.phone-notifications", "notifications"],
    ["app.schedules", "schedules"],
  ] as const)("%s opens Settings at %s", (id, section) => {
    run(id);
    expect(settingsUi.open).toBe(true);
    expect(settingsUi.section).toBe(section);
  });

  it("keeps the old names findable", () => {
    const titles = settingsCommands(null).map((c) => c.title);
    expect(titles).toEqual(
      expect.arrayContaining([
        "Settings",
        "Devices",
        "Notification settings",
        "Schedules",
        "Merge settings",
      ])
    );
  });

  it("scopes Schedules to the current workspace", () => {
    run("app.schedules", "w1");
    expect(schedulesUi.workspaceId).toBe("w1");
  });
});

describe("schedule entry points", () => {
  it("the sidebar's Schedules opens Settings > Schedules for its workspace", () => {
    schedulesUiActions.open("w2");
    expect(settingsUi).toMatchObject({ open: true, section: "schedules" });
    expect(schedulesUi.workspaceId).toBe("w2");
    expect(schedulesUi.draft).toBeNull();
  });

  it("a session's Schedule check-ins opens it with the form filled in", () => {
    const draft = {
      kind: "message" as const,
      targetSessionId: "s1",
      name: "Check in",
    };
    schedulesUiActions.openDraft("w3", draft);
    expect(settingsUi).toMatchObject({ open: true, section: "schedules" });
    expect(schedulesUi.draft).toEqual(draft);
  });
});

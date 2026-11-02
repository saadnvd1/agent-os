import "@/components/Chat/composer/test-dom";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

for (const key of Object.getOwnPropertyNames(window))
  if (
    /^(HTML|SVG|Event|CustomEvent|FocusEvent|DocumentFragment|Node|Element|Mutation)/.test(
      key
    ) &&
    !(key in globalThis)
  )
    Object.defineProperty(globalThis, key, {
      value: (window as unknown as Record<string, unknown>)[key],
      configurable: true,
      writable: true,
    });
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const ws = (id: string, name: string, limit: number | null) => ({
  id,
  name,
  max_running_tasks: limit,
  orch_full_access: false,
  wake_tasks_on_pr: true,
  orch_mcp_servers: [],
});
const state = vi.hoisted(() => ({
  workspaces: [] as unknown[],
  projects: [] as unknown[],
  sidebar: null as unknown,
  update: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
vi.mock("@/data/workspaces", () => ({
  useWorkspacesQuery: () => ({ isPending: false, data: state.workspaces }),
  useUpdateWorkspace: () => ({ mutateAsync: state.update }),
}));
vi.mock("@/data/projects", () => ({
  useProjectsQuery: () => ({ data: state.projects }),
}));
vi.mock("@/hooks/useSelectedWorkspace", () => ({
  useSelectedWorkspace: () => ({ workspace: state.sidebar }),
}));
vi.mock("@/components/Settings/AppWideLimits", () => ({
  AppWideLimits: () => null,
}));
for (const name of [
  "RulesForm",
  "McpServersForm",
  "HqFolderForm",
  "ProjectTiersForm",
  "WorkspaceModeForm",
  "WorkspaceModelsForm",
])
  vi.doMock(`./${name}`, () => ({
    [name]: () => null,
  }));

const { WorkspaceSettings } = await import("./WorkspaceSettings");
const { SettingsQueryContext } =
  await import("@/components/Settings/SettingRow");

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  localStorage.clear();
  state.update.mockReset().mockResolvedValue(undefined);
  state.workspaces = [ws("w1", "Alpha", null), ws("w2", "Beta", 2)];
  state.projects = [
    { id: "p1", name: "beta-api", workspace_id: "w2", is_uncategorized: false },
  ];
  state.sidebar = null;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

const render = (query = "") =>
  act(async () =>
    root.render(
      createElement(
        SettingsQueryContext.Provider,
        { value: query },
        createElement(WorkspaceSettings)
      )
    )
  );
const picker = () => host.querySelector<HTMLElement>("#settings-workspace")!;
const titles = () => [...host.querySelectorAll("h3")].map((h) => h.textContent);
const limit = () =>
  host.querySelector<HTMLInputElement>("#task-limit-w1, #task-limit-w2")!;

describe("WorkspaceSettings", () => {
  it("shows one workspace at a time, in titled groups", async () => {
    await render();
    expect(host.querySelectorAll('[role="group"]')).toHaveLength(1);
    expect(picker().textContent).toBe("Alpha");
    expect(titles()).toEqual(
      expect.arrayContaining(["Limits & mode", "Orchestrator"])
    );
    expect(host.textContent).not.toContain("Running task limit:");
  });

  it("preselects the sidebar's workspace", async () => {
    state.sidebar = state.workspaces[1];
    await render();
    expect(picker().textContent).toBe("Beta");
  });

  it("remembers the choice", async () => {
    localStorage.setItem("agentOS-settings-workspace", "w2");
    await render();
    expect(picker().textContent).toBe("Beta");
  });

  it("greys the number while the limit is off, keeping its value", async () => {
    await render();
    expect(limit().id).toBe("task-limit-w1");
    expect(limit().disabled).toBe(true);
    expect(limit().value).toBe("3");
    expect(host.textContent).not.toContain("Default");
  });

  it("enables the number when a limit is set, and hints the default", async () => {
    localStorage.setItem("agentOS-settings-workspace", "w2");
    await render();
    expect(limit().disabled).toBe(false);
    expect(limit().value).toBe("2");
    expect(host.textContent).toContain("Default: off");
    expect(
      [...host.querySelectorAll("button")].some(
        (b) => b.textContent === "Reset"
      )
    ).toBe(true);
  });

  it("a search matching only another workspace's project switches to it", async () => {
    await render("beta-api");
    expect(picker().textContent).toBe("Beta");
  });

  it("a search matching rows on every page stays on the current workspace", async () => {
    await render("mcp");
    expect(picker().textContent).toBe("Alpha");
  });
});

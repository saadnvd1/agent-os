"use client";

import { useSnapshot } from "valtio";
import { useTheme } from "next-themes";
import {
  Archive,
  ChefHat,
  Code,
  FolderGit2,
  FolderPlus,
  Gauge,
  LayoutGrid,
  ListTodo,
  MessageSquare,
  MessageSquarePlus,
  MessagesSquare,
  Moon,
  Plus,
  Sun,
  Workflow,
  Scale,
} from "lucide-react";
import type { Session } from "@/lib/db";
import type { PaletteCommand } from "@/lib/palette/registry";
import { useWorkspacesQuery } from "@/data/workspaces";
import { useRecipesQuery } from "@/data/recipes";
import { recipesUiActions } from "@/stores/recipesUi";
import { usePaletteCommands } from "@/hooks/usePaletteCommands";
import { archivedUiActions } from "@/stores/archivedUi";
import { busUiActions } from "@/stores/busUi";
import { orchestratorOpenActions } from "@/stores/orchestratorOpen";
import { sidebarUi, sidebarUiActions } from "@/stores/sidebarUi";
import { tasksUiActions } from "@/stores/tasksUi";
import { newDraft } from "@/stores/drafts";
import { useAddProject } from "@/components/Projects/AddProject/useAddProject";
import { useAddExistingProject } from "@/components/Projects/AddProject/useAddExistingProject";
import { usageUiActions } from "@/stores/usageUi";
import { settingsCommands } from "@/components/Settings/commands";
import { DRAFT_KEYS } from "@/lib/drafts";
import { useAwayCommands } from "@/components/Away/useAwayCommands";

const LAST_THEME = "agentOS-last-theme-";

// The other mode, in the variant last used in it (dark purple stays purple).
function switchMode(current: string | undefined, to: "light" | "dark"): string {
  try {
    if (current && current !== "system")
      localStorage.setItem(
        LAST_THEME + (to === "dark" ? "light" : "dark"),
        current
      );
    return localStorage.getItem(LAST_THEME + to) ?? to;
  } catch {
    return to;
  }
}

// The palette's app-wide commands and its session search.
export function useAppCommands({
  sessions,
  onSelectSession,
  onSearchCode,
}: {
  sessions: Session[];
  onSelectSession: (session: Session) => void;
  onSearchCode: () => void;
}) {
  const { theme, resolvedTheme, setTheme } = useTheme();
  const { data: workspaces = [] } = useWorkspacesQuery();
  const { workspaceId } = useSnapshot(sidebarUi);
  const current = workspaces.find((w) => w.id === workspaceId) ?? null;
  const dark = resolvedTheme?.startsWith("dark") ?? false;
  const { data: recipes = [] } = useRecipesQuery(workspaceId ?? null);
  const addProject = useAddProject();
  const addExisting = useAddExistingProject();

  const app: PaletteCommand[] = [
    {
      id: "app.new-session",
      title: "New session",
      group: "Actions",
      keywords: ["create", "start", "chat", "draft"],
      hint: DRAFT_KEYS.current,
      icon: Plus,
      run: () => newDraft({ kind: "current" }),
    },
    {
      id: "app.new-session-in",
      title: "New session in project…",
      group: "Actions",
      keywords: ["create", "start", "choose", "pick"],
      hint: DRAFT_KEYS.choose,
      icon: FolderGit2,
      run: () => newDraft({ kind: "choose" }),
    },
    {
      id: "app.new-scratch",
      title: "New scratch chat",
      group: "Actions",
      keywords: ["create", "no project", "quick"],
      hint: DRAFT_KEYS.scratch,
      icon: MessageSquarePlus,
      run: () => newDraft({ kind: "scratch" }),
    },
    {
      id: "app.new-task",
      title: "New task",
      group: "Actions",
      keywords: ["background", "pull request", "pr"],
      icon: ListTodo,
      run: () => newDraft({ kind: "current", openPr: true }),
    },
    {
      id: "app.add-project",
      title: "Add project",
      group: "Actions",
      keywords: ["clone", "folder", "repository", "new project", "git init"],
      icon: FolderPlus,
      run: addProject,
    },
    ...(current
      ? [
          {
            id: "app.add-project-to-workspace",
            title: `Add project to ${current.name}`,
            group: "Actions",
            keywords: ["existing", "move", "workspace", "project"],
            icon: FolderPlus,
            run: () => addExisting(current),
          },
          {
            id: "app.orchestrator",
            title: `Open ${current.name}'s orchestrator`,
            group: "Actions",
            keywords: ["orchestrator", "workspace"],
            icon: Workflow,
            run: () => orchestratorOpenActions.request(current.id),
          },
        ]
      : []),
    {
      id: "app.recipes",
      title: "Recipes",
      group: "Go to",
      keywords: ["saved", "jobs", "repeat", "testflight"],
      icon: ChefHat,
      run: () => recipesUiActions.open(workspaceId ?? null),
    },
    ...recipes.map((r) => ({
      id: `app.recipe.${r.id}`,
      title: `Run recipe: ${r.name}`,
      group: "Actions",
      keywords: ["recipe", "run", r.projectName ?? ""],
      icon: ChefHat,
      run: () => recipesUiActions.openRecipe(r.id, true),
    })),
    {
      id: "app.search-code",
      title: "Search code",
      group: "Actions",
      keywords: ["grep", "ripgrep", "find in files"],
      icon: Code,
      run: onSearchCode,
    },
    {
      id: "app.usage",
      title: "Usage",
      group: "Go to",
      keywords: ["cost", "tokens", "limits", "spend", "window"],
      icon: Gauge,
      run: () => usageUiActions.open(),
    },
    {
      id: "app.model-comparison",
      title: "Model comparison",
      group: "Go to",
      keywords: [
        "models",
        "routing",
        "providers",
        "before after",
        "quality",
        "deepseek",
        "glm",
        "cost",
      ],
      icon: Scale,
      run: () => usageUiActions.open("compare"),
    },
    {
      id: "app.tasks",
      title: "Tasks",
      group: "Go to",
      icon: ListTodo,
      run: tasksUiActions.openPanel,
    },
    {
      id: "app.messages",
      title: "Messages",
      group: "Go to",
      keywords: ["bus", "peers"],
      icon: MessagesSquare,
      run: busUiActions.open,
    },
    {
      id: "app.archived",
      title: "Archived",
      group: "Go to",
      icon: Archive,
      run: () => archivedUiActions.open(),
    },
    ...settingsCommands(current?.id ?? null),
    {
      id: "app.theme",
      title: dark ? "Switch to light theme" : "Switch to dark theme",
      group: "Settings",
      keywords: ["theme", "dark mode", "light mode", "appearance"],
      icon: dark ? Sun : Moon,
      run: () => setTheme(switchMode(theme, dark ? "light" : "dark")),
    },
    ...[null, ...workspaces]
      .filter((w) => (w?.id ?? null) !== workspaceId)
      .map((w) => ({
        id: `workspace.${w?.id ?? "all"}`,
        title: `Switch to ${w?.name ?? "all workspaces"}`,
        group: "Workspaces",
        keywords: ["workspace"],
        icon: LayoutGrid,
        run: () => sidebarUiActions.setWorkspace(w?.id ?? null),
      })),
  ];
  usePaletteCommands("app", app);
  useAwayCommands();

  usePaletteCommands(
    "sessions",
    sessions
      .filter((s) => !s.archived_at && !s.conductor_session_id)
      .map((s) => ({
        id: `session.${s.id}`,
        title: s.name,
        group: "Sessions",
        keywords: [s.working_directory, s.branch_name ?? ""].filter(Boolean),
        icon: MessageSquare,
        run: () => onSelectSession(s),
      }))
  );
}

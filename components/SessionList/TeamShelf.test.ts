import "@/components/Chat/composer/test-dom";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "@/lib/db/types";
import { buildShelves } from "@/lib/sidebar/shelves";
import { teamMembers } from "@/lib/sidebar/orchestrator-row";
import { sidebarUi } from "@/stores/sidebarUi";
import { SessionShelves } from "./SessionShelves";
import { RowProvider, type RowContextValue } from "./RowContext";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLElement;

beforeEach(() => {
  vi.stubGlobal("fetch", () => new Promise(() => {}));
  host = document.createElement("div");
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  vi.unstubAllGlobals();
});

const at = "2026-11-01 10:00:00";
const session = (over: Partial<Session>): Session =>
  ({
    name: over.id,
    created_at: at,
    updated_at: at,
    last_active_at: at,
    pinned: false,
    role: null,
    workspace_id: "w1",
    project_id: "p1",
    ...over,
  }) as Session;

// Typed in full, so a field the rows start reading fails tsc, not CI.
const ctx: RowContextValue = {
  summarizingSessionId: null,
  projects: [],
  projectNames: new Map([["p1", "Shop"]]),
  workspaceNames: new Map([
    ["w1", "Workstak"],
    ["w2", "Internal Tools"],
  ]),
  orchestrators: [],
  runningByWorkspace: new Map([["w1", 1]]),
  queuedByWorkspace: new Map(),
  rollups: new Map(),
  orchestratorNames: new Map([["o1", "Workstak"]]),
  team: new Map(),
  orderedIds: () => [],
  cardUrl: () => null,
  onSelect: vi.fn(),
  onRename: vi.fn(),
  onFork: vi.fn(),
  onSummarize: vi.fn(),
  onDelete: vi.fn(),
  onMoveToProject: vi.fn(),
  onPin: vi.fn(),
  onFresh: vi.fn(),
};

const render = async (sessions: Session[], value = ctx, foldTeams = false) => {
  const shelves = buildShelves({
    leadRanks: new Map([...value.team].map(([id, m]) => [id, m.rank])),
    sessions,
    statuses: { t1: { status: "running" } as never },
    tasks: {},
    projectName: () => "Shop",
    currentOrchestrators: new Set(["o1", ...value.team.keys()]),
    now: Date.parse("2026-11-01T12:00:00Z"),
  });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  await act(async () =>
    root.render(
      createElement(
        QueryClientProvider,
        { client },
        createElement(
          RowProvider,
          { value },
          createElement(SessionShelves, {
            shelves,
            queued: [],
            toStart: [{ workspaceId: "w2", name: "Internal Tools" }],
            doneCollapsed: true,
            snoozedCollapsed: true,
            donePages: 1,
            foldTeams,
          })
        )
      )
    )
  );
  return host.innerHTML;
};

const today = [
  session({ id: "o1", name: "Workstak", role: "orchestrator", pinned: true }),
  session({ id: "pin1", name: "Notes", pinned: true }),
  session({ id: "t1", name: "Fix invoice export", started_by: "o1" }),
];

describe("a workspace without leads", () => {
  it("renders the sidebar exactly as before leads", async () => {
    expect(await render(today)).toMatchSnapshot();
  });
});

describe("a workspace with leads", () => {
  // Created out of order: the cards still come chief, Tech, Marketing, Product.
  const sessions = [
    session({
      id: "pr",
      name: "Product",
      role: "lead",
      lead_kind: "product",
      pinned: true,
    }),
    ...today,
    session({
      id: "mk",
      name: "Marketing",
      role: "lead",
      lead_kind: "marketing",
      pinned: true,
    }),
    session({ id: "ch", name: "Chief", role: "chief", pinned: true }),
    session({ id: "t2", name: "Landing screenshots", started_by: "mk" }),
  ];
  const team = teamMembers([
    {
      workspaceId: "w1",
      team: [
        { kind: "chief", title: "Chief of staff", sessionId: "ch" },
        { kind: "tech", title: "Tech lead", sessionId: "o1" },
        { kind: "marketing", title: "Marketing lead", sessionId: "mk" },
        { kind: "product", title: "Product lead", sessionId: "pr" },
      ],
    },
  ]);
  const orchestrators = [
    {
      workspaceId: "w1",
      sessionId: "o1",
      paused: false,
      inReview: 1,
      asks: [{ leadKind: "marketing" }, { leadKind: "tech" }] as never,
      questions: [],
      dismissed: [],
      cards: [],
    },
  ];
  const value = { ...ctx, team, orchestrators };
  const titles = () =>
    [...host.querySelectorAll("[data-session-row]")]
      .slice(0, 4)
      .map((e) => e.getAttribute("data-tip")?.split("\n")[0]);

  it("gives each member a card under the team's label, in team order", async () => {
    await render(sessions, value);
    expect(host.textContent).toContain("Workstak · team");
    expect(titles()).toEqual([
      "Chief of staff",
      "Tech lead",
      "Marketing lead",
      "Product lead",
    ]);
    const card = (id: string) =>
      host.querySelector(`[data-session-row="${id}"]`)!.textContent;
    // Tech carries the workspace's work and its own ask; Marketing only its own.
    expect(card("o1")).toBe(
      "TTech leadWaiting · 1 running · 1 in review · 1 ask"
    );
    expect(card("mk")).toBe("MMarketing leadIdle · 1 ask");
    expect(card("ch")).toBe("CChief of staffIdle");
    expect(host.querySelector("[data-team-row]")).toBeNull();
  });

  it("marks the work each lead started with its avatar", async () => {
    await render(sessions, value);
    const row = host.querySelector('[data-session-row="t2"]')!;
    expect(
      row.querySelector('[aria-label="Via Marketing lead"]')
    ).not.toBeNull();
    const plain = host.querySelector('[data-session-row="t1"]')!;
    expect(plain.querySelector('[aria-label="Via Tech lead"]')).not.toBeNull();
  });

  it("folds into one row under All workspaces, which opens the workspace", async () => {
    await render(sessions, value, true);
    const rows = host.querySelectorAll("[data-team-row]");
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toBe(
      "WorkstakCTMP2 needs you · 1 running · 1 in review"
    );
    for (const id of ["ch", "o1", "mk", "pr"])
      expect(host.querySelector(`[data-session-row="${id}"]`)).toBeNull();
    act(() => (rows[0] as HTMLElement).click());
    expect(sidebarUi.workspaceId).toBe("w1");
  });
});

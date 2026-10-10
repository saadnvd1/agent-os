"use client";

import { useEffect, useRef } from "react";
import { subscribe } from "valtio";
import { FolderGit2 } from "lucide-react";
import type { Session } from "@/lib/db";
import type { ProjectWithDevServers } from "@/lib/projects";
import {
  currentProjectId,
  newDraft as makeDraft,
  reusableDraft,
  type Draft,
} from "@/lib/drafts";
import { projectsInWorkspace } from "@/lib/sidebar/shelves";
import { useSelectedWorkspace } from "@/hooks/useSelectedWorkspace";
import {
  draftHasText,
  draftRequests,
  draftsActions,
  draftsStore,
  hydrateDrafts,
  type DraftRequest,
} from "@/stores/drafts";
import { paletteActions } from "@/stores/palette";
import { sidebarUi } from "@/stores/sidebarUi";
import { uuid } from "@/lib/uuid";

interface Options {
  sessions: Session[];
  projects: ProjectWithDevServers[];
  // The session or draft in the focused tab.
  viewing: { session?: Session; draftId?: string | null };
  show: (draftId: string) => void;
}

// Opens drafts asked for anywhere: reuses a project's empty draft, else
// makes one carrying the agent, model and access you were using. "New" and
// "In project…" stay inside the workspace selected in the sidebar.
export function useDraftRequests(options: Options) {
  const { workspace } = useSelectedWorkspace();
  const latest = useRef({ ...options, workspaceId: workspace?.id ?? null });
  useEffect(() => {
    latest.current = { ...options, workspaceId: workspace?.id ?? null };
  });

  useEffect(() => {
    hydrateDrafts();
    const open = (projectId: string | null, openPr = false) => {
      const { projects, viewing, show } = latest.current;
      const drafts = Object.values(draftsStore.drafts) as Draft[];
      const found = reusableDraft(drafts, projectId, draftHasText, openPr);
      if (found) return show(found.id);
      const from = viewing.draftId ? draftsStore.drafts[viewing.draftId] : null;
      const s = viewing.session;
      const carry = from
        ? { agentType: from.agentType, model: from.model, access: from.access }
        : s
          ? { agentType: s.agent_type, model: s.model, access: s.chat_access }
          : {};
      const project = projects.find((p) => p.id === projectId) ?? null;
      const draft = makeDraft(uuid(), project, carry, { openPr });
      draftsActions.put(draft);
      show(draft.id);
    };

    const choose = (openPr?: boolean) => {
      const { projects, workspaceId } = latest.current;
      const real = projectsInWorkspace(projects, workspaceId).filter(
        (p) => !p.is_uncategorized
      );
      if (real.length <= 1) return open(real[0]?.id ?? null, openPr);
      paletteActions.pick(
        openPr ? "New task in…" : "New session in…",
        real.map((p) => ({
          id: `draft.project.${p.id}`,
          title: p.name,
          group: "",
          keywords: [p.working_directory],
          icon: FolderGit2,
          run: () => open(p.id, openPr),
        }))
      );
    };

    const handle = (r: DraftRequest) => {
      const { sessions, projects, viewing, show, workspaceId } = latest.current;
      if (r.kind === "open") return show(r.draftId);
      // Not loaded yet (once loaded, Scratch is always there): picking a
      // project now would wrongly fall back to a scratch chat.
      if (!projects.length) return;
      if (r.kind === "scratch") return open(null);
      if (r.kind === "project") return open(r.projectId, r.openPr);
      if (r.kind === "choose") return choose(r.openPr);
      const draft = viewing.draftId
        ? draftsStore.drafts[viewing.draftId]
        : undefined;
      const here = draft
        ? { projectId: draft.projectId }
        : viewing.session
          ? { projectId: viewing.session.project_id }
          : null;
      const id = currentProjectId(here, sessions, projects, {
        workspaceId,
        projectId: sidebarUi.projectId,
      });
      if (id || r.openPr) return id ? open(id, r.openPr) : choose(true);
      open(null);
    };

    return subscribe(draftRequests, () => {
      const r = draftRequests.request;
      if (!r) return;
      draftRequests.request = null;
      handle(r);
    });
  }, []);
}

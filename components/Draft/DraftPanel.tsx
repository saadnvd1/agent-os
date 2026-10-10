"use client";

import { useState } from "react";
import { useSnapshot } from "valtio";
import { toast } from "sonner";
import { Composer } from "@/components/Chat/Composer";
import { Button } from "@/components/ui/button";
import type { ChatImage } from "@/lib/chat/events";
import type { Project } from "@/lib/db";
import { draftComposerKey, type Draft } from "@/lib/drafts";
import { getModelOptions } from "@/lib/model-catalog";
import { useHostsQuery } from "@/data/hosts";
import { useGitCheck } from "@/data/git/queries";
import { useLaunchSession } from "@/data/sessions";
import { useCreateTask } from "@/data/tasks";
import { usePanes } from "@/contexts/PaneContext";
import { setPendingPrompt } from "@/stores/initialPrompt";
import { draftsActions, draftsStore, newDraft } from "@/stores/drafts";
import { DraftChips } from "./DraftChips";
import { DraftHeading } from "./DraftHeading";

// A new session before its first send: choices on top, a composer below.
// Sending makes the session (and its worktree) and turns this tab into it.
export function DraftPanel({
  paneId,
  draftId,
  projects,
  active,
}: {
  paneId: string;
  draftId: string;
  projects: Project[];
  // The tab on show: only it takes the caret.
  active: boolean;
}) {
  const { drafts, hydrated } = useSnapshot(draftsStore);
  const draft = drafts[draftId] as Draft | undefined;
  const { attachSession } = usePanes();
  const { data: hosts = [] } = useHostsQuery();
  const project = projects.find((p) => p.id === draft?.projectId) ?? null;
  const { data: git } = useGitCheck(
    project && draft?.hostId === "local" ? project.working_directory : ""
  );
  const launch = useLaunchSession();
  const createTask = useCreateTask();
  const [prefill, setPrefill] = useState<{ text: string; at: number }>();
  const pending = launch.isPending || createTask.isPending;

  if (!hydrated) return null;
  if (!draft)
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="text-muted-foreground text-sm">This draft is gone.</p>
        <Button onClick={() => newDraft({ kind: "current" })}>
          New session
        </Button>
      </div>
    );

  const send = async (text: string, images: ChatImage[]) => {
    try {
      if (draft.openPr) {
        if (!project) throw new Error("Pick a project for a task");
        if (images.length) throw new Error("A task takes text only");
        const { session, queued } = await createTask.mutateAsync({
          projectId: project.id,
          prompt: text,
          model: draft.model,
          baseBranch: draft.baseBranch ?? undefined,
          hostId: draft.hostId !== project.host_id ? draft.hostId : undefined,
          view: draft.terminal ? "terminal" : undefined,
        });
        draftsActions.remove(draft.id);
        if (queued) {
          toast.success(
            `Task queued (position ${queued.position}): it starts by itself when a slot frees`
          );
          return;
        }
        attachSession(paneId, session.id, `claude-${session.id}`, draft.hostId);
        toast.success("Task started: it opens a pull request when done");
        return;
      }
      const { session, initialPrompt } = await launch.mutateAsync({
        projectId: project?.id ?? null,
        id: draft.id,
        hostId:
          !project || draft.hostId !== project.host_id
            ? draft.hostId
            : undefined,
        agentType: draft.agentType,
        model: draft.model,
        access: draft.access,
        useWorktree: draft.useWorktree && !!git?.isGitRepo,
        baseBranch: draft.baseBranch,
        prompt: text,
        images: images.length ? images : undefined,
      });
      if (initialPrompt) setPendingPrompt(session.id, initialPrompt);
      draftsActions.remove(draft.id);
      attachSession(
        paneId,
        session.id,
        session.tmux_name ?? "",
        session.host_id
      );
    } catch (error) {
      setPrefill({ text, at: Date.now() });
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <DraftHeading draft={draft} projectName={project?.name ?? null} />
      </div>
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-2 px-3 pb-3">
        <DraftChips
          draft={draft}
          projects={projects}
          hosts={hosts}
          git={git}
          onChange={(patch) => draftsActions.update(draft.id, patch)}
        />
        <Composer
          draftKey={draftComposerKey(draft.id)}
          running={false}
          disabled={pending}
          placeholder={
            pending
              ? "Starting…"
              : draft.openPr
                ? "Describe the task"
                : `Message ${project?.name ?? "a new chat"}`
          }
          onSend={(text, images) => void send(text, images)}
          onStop={() => {}}
          models={getModelOptions(draft.agentType)}
          model={draft.model}
          onSetModel={(model) => draftsActions.update(draft.id, { model })}
          access={draft.openPr ? undefined : draft.access}
          onSetAccess={(access) => draftsActions.update(draft.id, { access })}
          prefill={prefill}
          autoFocus={active}
        />
      </div>
    </div>
  );
}

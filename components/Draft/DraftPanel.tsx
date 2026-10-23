"use client";

import { useState } from "react";
import { useSnapshot } from "valtio";
import { toast } from "sonner";
import { Composer } from "@/components/Chat/Composer";
import { Button } from "@/components/ui/button";
import type { ChatFile, ChatImage } from "@/lib/chat/events";
import type { Project } from "@/lib/db";
import { draftComposerKey, type Draft } from "@/lib/drafts";
import { discoversModels } from "@/lib/model-catalog";
import { useDiscoveredModels } from "@/data/agents";
import { useHostsQuery } from "@/data/hosts";
import { useGitCheck } from "@/data/git/queries";
import { useSelectedWorkspace } from "@/hooks/useSelectedWorkspace";
import { useLaunchSession } from "@/data/sessions";
import { ModelUnavailableError } from "@/data/sessions/queries";
import { isAgentRole } from "@/lib/models/agent-roles";
import { useCreateTask } from "@/data/tasks";
import { useCheckStart } from "@/data/claims";
import { StartClaimsNotice } from "@/components/Claims";
import type { StartWarning } from "@/lib/claims/startWarning";
import { usePanes } from "@/contexts/PaneContext";
import { setPendingPrompt } from "@/stores/initialPrompt";
import { draftsActions, draftsStore, newDraft } from "@/stores/drafts";
import { useStartAnalystBeside } from "@/components/Analyst/pair";
import { DraftChips } from "./DraftChips";
import { DraftHeading } from "./DraftHeading";
import { ModelUnavailableDialog } from "./ModelUnavailableDialog";
import { useMachineCatalog } from "@/data/machines";
import { draftModels } from "./draftModels";

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
  const { data: hosts = [], isSuccess: hostsLoaded } = useHostsQuery();
  const project = projects.find((p) => p.id === draft?.projectId) ?? null;
  const { data: git } = useGitCheck(
    project && draft?.hostId === "local" ? project.working_directory : ""
  );
  const discovers = !!draft && discoversModels(draft.agentType);
  const found = useDiscoveredModels(
    draft?.agentType ?? "",
    draft?.projectId ?? null,
    discovers
  );
  // On another machine the models are the ones it reports, not this one's.
  const there = useMachineCatalog(draft?.hostId ?? "local");
  const launch = useLaunchSession();
  const startAnalyst = useStartAnalystBeside();
  const { workspace } = useSelectedWorkspace();
  const createTask = useCreateTask();
  const checkStart = useCheckStart();
  const [prefill, setPrefill] = useState<{ text: string; at: number }>();
  // A task start that overlaps claimed work waits here for the person's choice.
  const [held, setHeld] = useState<{
    text: string;
    warnings: StartWarning[];
  } | null>(null);
  // A role's model server that didn't answer, with what was being sent.
  const [down, setDown] = useState<{
    error: ModelUnavailableError;
    text: string;
    images: ChatImage[];
    files: ChatFile[];
  } | null>(null);
  const pending =
    launch.isPending || createTask.isPending || checkStart.isPending;

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

  const send = async (
    text: string,
    images: ChatImage[],
    files: ChatFile[],
    claim?: { after?: string; onUnavailable?: "fallback" }
  ) => {
    try {
      if (draft.openPr) {
        if (!project) throw new Error("Pick a project for a task");
        if (images.length || files.length)
          throw new Error("A task takes text only");
        if (!claim && draft.hostId === project.host_id) {
          const warnings = await checkStart.mutateAsync({
            projectId: project.id,
            prompt: text,
          });
          if (warnings.length) {
            setHeld({ text, warnings });
            return;
          }
        }
        setHeld(null);
        const { session, queued } = await createTask.mutateAsync({
          projectId: project.id,
          prompt: text,
          after: claim?.after,
          model: draft.taskModel ?? undefined,
          priority: draft.taskPriority,
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
      const { session, initialPrompt, repeat } = await launch.mutateAsync({
        projectId: project?.id ?? null,
        workspaceId: draft.workspaceId ?? workspace?.id ?? null,
        id: draft.id,
        hostId:
          !project || draft.hostId !== project.host_id
            ? draft.hostId
            : undefined,
        agentType: draft.agentType,
        model: isAgentRole(draft.agentRole)
          ? (draft.roleModel ?? "")
          : draft.model,
        ...(isAgentRole(draft.agentRole)
          ? {
              agentRole: draft.agentRole,
              ...(claim?.onUnavailable && {
                onUnavailable: claim.onUnavailable,
              }),
            }
          : {}),
        access: draft.access,
        useWorktree: draft.useWorktree && !!git?.isGitRepo,
        baseBranch: draft.baseBranch,
        prompt: text,
        images: images.length ? images : undefined,
        files: files.length ? files : undefined,
      });
      // A resend whose first answer was lost: the terminal still needs its
      // first prompt, and this is the text that was sent.
      const prompt =
        initialPrompt ??
        (repeat && session.view === "terminal" && text.trim()
          ? text
          : undefined);
      if (prompt) setPendingPrompt(session.id, prompt);
      draftsActions.remove(draft.id);
      attachSession(
        paneId,
        session.id,
        session.tmux_name ?? "",
        session.host_id
      );
      if (draft.withAnalyst && project && draft.hostId === "local") {
        if (session.view === "chat")
          void startAnalyst.run({ coderSessionId: session.id }, paneId);
        else toast("An analyst reviews chats: this session runs in a terminal");
      }
    } catch (error) {
      if (error instanceof ModelUnavailableError) {
        setDown({ error, text, images, files });
        return;
      }
      setPrefill({ text, at: Date.now() });
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col" data-composer-scope>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <DraftHeading draft={draft} projectName={project?.name ?? null} />
      </div>
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-2 px-3 pb-3">
        <DraftChips
          draft={draft}
          projects={projects}
          hosts={hosts}
          hostsLoaded={hostsLoaded}
          git={git}
          onChange={(patch) => draftsActions.update(draft.id, patch)}
        />
        <ModelUnavailableDialog
          error={down?.error ?? null}
          busy={pending}
          onClose={() => {
            if (down) setPrefill({ text: down.text, at: Date.now() });
            setDown(null);
          }}
          onRetry={() => {
            const d = down;
            setDown(null);
            if (d) void send(d.text, d.images, d.files);
          }}
          onFallback={() => {
            const d = down;
            setDown(null);
            if (d)
              void send(d.text, d.images, d.files, {
                onUnavailable: "fallback",
              });
          }}
          onPick={() => {
            if (down) setPrefill({ text: down.text, at: Date.now() });
            setDown(null);
          }}
        />
        {held && (
          <StartClaimsNotice
            warnings={held.warnings}
            busy={pending}
            onStart={(after) => void send(held.text, [], [], { after })}
            onDismiss={() => {
              setPrefill({ text: held.text, at: Date.now() });
              setHeld(null);
            }}
          />
        )}
        <Composer
          draftKey={draftComposerKey(draft.id)}
          attachScope="draft"
          running={false}
          disabled={pending}
          placeholder={
            pending
              ? "Starting…"
              : draft.openPr
                ? "Describe the task"
                : `Message ${project?.name ?? "a new chat"}`
          }
          onSend={(text, images, files) => void send(text, images, files)}
          onStop={() => {}}
          models={
            (draft.hostId !== "local" &&
              there.data?.catalog?.agents.find(
                (a) => a.agent === draft.agentType
              )?.models) ||
            draftModels(draft.agentType, found)
          }
          model={draft.model}
          onSetModel={(model) => draftsActions.update(draft.id, { model })}
          access={draft.openPr ? undefined : draft.access}
          onSetAccess={(access) => draftsActions.update(draft.id, { access })}
          prefill={prefill}
          focusKey={active ? draftId : null}
        />
      </div>
    </div>
  );
}

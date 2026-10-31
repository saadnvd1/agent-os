"use client";

import { useEffect } from "react";
import {
  Cpu,
  Eye,
  FolderGit2,
  GitBranch,
  Flag,
  GitPullRequest,
  Monitor,
  SquareTerminal,
} from "lucide-react";
import type { Host } from "@/lib/db";
import type { Project } from "@/lib/db";
import { draftHostGone, newDraft, type Draft } from "@/lib/drafts";
import type { GitCheck } from "@/data/git/queries";
import { useProjectMachinesQuery } from "@/data/projects";
import { modelChoices, useModelsQuery } from "@/data/models";
import { useBrowserMachine } from "@/data/machines";
import { machineLabel } from "@/lib/machines/label";
import { RoleChips } from "./RoleChips";
import { AnalystModelChip } from "./AnalystModelChip";
import { AgentModelChip } from "./AgentModelChip";
import { ChipHeading, ChipItem, ChipMenu, ChipToggle } from "./Chip";
import {
  DEFAULT_PRIORITY,
  PRIORITIES,
  PRIORITY_HINT,
  PRIORITY_LABEL,
} from "@/lib/tasks/schedule-types";

const BRANCHES_SHOWN = 20;

// A draft's choices, above its composer: where it runs and how.
export function DraftChips({
  draft,
  projects,
  hosts,
  hostsLoaded,
  git,
  onChange,
}: {
  draft: Draft;
  projects: Project[];
  hosts: Host[];
  // Until it has, no machine counts as gone.
  hostsLoaded: boolean;
  git: GitCheck | undefined;
  onChange: (patch: Partial<Draft>) => void;
}) {
  const browser = useBrowserMachine();
  const real = projects.filter((p) => !p.is_uncategorized);
  const project = real.find((p) => p.id === draft.projectId) ?? null;
  const projectHere = !!project && (project.host_id || "local") === "local";
  // A task, or a session for a project here, runs on another machine through
  // that machine's own AgentOS, so only linked ones; a scratch chat runs
  // over ssh on any.
  const machines =
    draft.openPr || projectHere
      ? hosts.filter((h) => h.id === "local" || Boolean(h.linked))
      : hosts;
  const host = hosts.find((h) => h.id === draft.hostId);
  const local = draft.hostId === "local";
  const base = draft.baseBranch ?? git?.defaultBranch ?? "main";
  const { data: models } = useModelsQuery(draft.openPr);
  // A project elsewhere runs where it lives; a scratch chat, a task or a
  // project here can go to another machine.
  const canMove = !project || draft.openPr || projectHere;
  // Which linked machines have the project or can clone it.
  const checkMachines = projectHere && !draft.openPr && machines.length > 1;
  const onMachines = useProjectMachinesQuery(checkMachines ? project.id : null);
  const unavailable = (hostId: string): string | null => {
    if (!checkMachines || hostId === "local") return null;
    if (onMachines.isError) return "Couldn't check this machine";
    if (!onMachines.data) return "Checking…";
    return onMachines.data[hostId] ?? null;
  };
  // A draft kept for a machine that was unlinked goes back to this one,
  // rather than failing on send.
  const hostGone = draftHostGone(
    draft,
    projectHere,
    hostsLoaded ? machines : null
  );
  useEffect(() => {
    if (hostGone) onChange({ hostId: "local", useWorktree: true });
  }, [hostGone, onChange]);

  const pickProject = (id: string | null) => {
    const next = newDraft(
      draft.id,
      real.find((p) => p.id === id) ?? null,
      {
        agentType: draft.agentType,
        model: draft.model,
        access: draft.access,
      },
      { workspaceId: draft.workspaceId }
    );
    onChange({
      ...next,
      openPr: !!id && draft.openPr,
      createdAt: draft.createdAt,
    });
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <ChipMenu
        icon={FolderGit2}
        name="Project"
        label={project?.name ?? "No project"}
      >
        <ChipItem
          checked={!project}
          onSelect={() => pickProject(null)}
          hint="A scratch folder"
        >
          No project
        </ChipItem>
        {real.map((p) => (
          <ChipItem
            key={p.id}
            checked={p.id === draft.projectId}
            onSelect={() => pickProject(p.id)}
            hint={p.working_directory}
          >
            {p.name}
          </ChipItem>
        ))}
      </ChipMenu>

      {machines.length > 1 && (
        <ChipMenu
          icon={Monitor}
          name="Machine"
          label={host ? machineLabel(host) : draft.hostId}
          disabled={!canMove}
          title={canMove ? undefined : "Runs where the project lives"}
        >
          {machines.map((h) => (
            <ChipItem
              key={h.id}
              checked={h.id === draft.hostId}
              disabled={!!unavailable(h.id)}
              hint={unavailable(h.id) ?? undefined}
              onSelect={() =>
                onChange({
                  hostId: h.id,
                  useWorktree: h.id === "local" && !!project,
                })
              }
            >
              {machineLabel(h, browser.hostId)}
            </ChipItem>
          ))}
        </ChipMenu>
      )}

      {!draft.openPr && !draft.agentRole && (
        <AgentModelChip
          draft={draft}
          projectName={project?.name ?? null}
          onChange={onChange}
        />
      )}

      {!draft.openPr && local && (
        <RoleChips draft={draft} onChange={onChange} />
      )}

      {project && local && git?.isGitRepo && (
        <ChipMenu
          icon={GitBranch}
          name="Checkout"
          label={
            draft.useWorktree || draft.openPr
              ? `Worktree from ${base}`
              : "Current checkout"
          }
        >
          {!draft.openPr && (
            <>
              <ChipItem
                checked={draft.useWorktree}
                onSelect={() => onChange({ useWorktree: true })}
                hint="Its own branch and folder"
              >
                New worktree
              </ChipItem>
              <ChipItem
                checked={!draft.useWorktree}
                onSelect={() => onChange({ useWorktree: false })}
                hint={git.currentBranch ? `On ${git.currentBranch}` : undefined}
              >
                Current checkout
              </ChipItem>
            </>
          )}
          {(draft.useWorktree || draft.openPr) && (
            <>
              <ChipHeading>Base branch</ChipHeading>
              {git.branches.slice(0, BRANCHES_SHOWN).map((b) => (
                <ChipItem
                  key={b}
                  checked={b === base}
                  onSelect={() =>
                    onChange({
                      baseBranch: b === git.defaultBranch ? null : b,
                    })
                  }
                >
                  {b}
                </ChipItem>
              ))}
            </>
          )}
        </ChipMenu>
      )}

      {project && (
        <ChipToggle
          icon={GitPullRequest}
          label="Open a PR when done"
          on={draft.openPr}
          title="Works alone in a worktree and opens a pull request"
          onChange={(openPr) => onChange({ openPr })}
        />
      )}
      {project && !draft.openPr && local && draft.agentRole !== "analyst" && (
        <ChipToggle
          icon={Eye}
          label="With analyst"
          on={!!draft.withAnalyst}
          title="A second chat reviews each turn and drafts the next prompt for you to send"
          onChange={(withAnalyst) => onChange({ withAnalyst })}
        />
      )}
      {project && !draft.openPr && local && draft.withAnalyst && (
        <AnalystModelChip
          draft={draft}
          projectId={project.id}
          onChange={onChange}
        />
      )}
      {project && draft.openPr && local && (
        <ChipMenu
          icon={Cpu}
          name="Model"
          label={draft.taskModel ?? "Routed by role"}
        >
          <ChipItem
            checked={!draft.taskModel}
            onSelect={() => onChange({ taskModel: null })}
            hint="Plans and implements on the role models in Settings"
          >
            Routed by role
          </ChipItem>
          {modelChoices(models?.effective).map((c) => (
            <ChipItem
              key={c.ref}
              checked={c.ref === draft.taskModel}
              onSelect={() => onChange({ taskModel: c.ref })}
              hint={c.provider}
            >
              {c.label}
            </ChipItem>
          ))}
        </ChipMenu>
      )}
      {project && draft.openPr && (
        <ChipMenu
          icon={Flag}
          name="Priority"
          label={PRIORITY_LABEL[draft.taskPriority ?? DEFAULT_PRIORITY]}
        >
          {PRIORITIES.map((p) => (
            <ChipItem
              key={p}
              checked={p === (draft.taskPriority ?? DEFAULT_PRIORITY)}
              onSelect={() => onChange({ taskPriority: p })}
              hint={PRIORITY_HINT[p]}
            >
              {PRIORITY_LABEL[p]}
            </ChipItem>
          ))}
        </ChipMenu>
      )}
      {project && draft.openPr && (
        <ChipToggle
          icon={SquareTerminal}
          label="Terminal"
          on={!!draft.terminal}
          title="Runs in a terminal instead of a chat; only a terminal task can move"
          onChange={(terminal) => onChange({ terminal })}
        />
      )}
    </div>
  );
}

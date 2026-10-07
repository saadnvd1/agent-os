"use client";

import {
  Bot,
  FolderGit2,
  GitBranch,
  GitPullRequest,
  Monitor,
} from "lucide-react";
import type { Host } from "@/lib/db";
import type { Project } from "@/lib/db";
import { newDraft, type Draft } from "@/lib/drafts";
import { AGENT_OPTIONS, agentLabel } from "@/lib/agent-options";
import { resolveModelForAgent } from "@/lib/model-catalog";
import type { GitCheck } from "@/data/git/queries";
import { useAgentStatusQuery } from "@/data/agents";
import type { AgentProbe } from "@/lib/agents/probe";
import { ChipHeading, ChipItem, ChipMenu, ChipToggle } from "./Chip";

// What stands between an agent and its first prompt, if anything.
export function agentBlocker(probe?: AgentProbe): string | null {
  if (!probe) return null;
  if (!probe.installed) return "Not installed";
  if (probe.auth === "needs-login") return "Needs sign-in";
  return null;
}

const BRANCHES_SHOWN = 20;

// A draft's choices, above its composer: where it runs and how.
export function DraftChips({
  draft,
  projects,
  hosts,
  git,
  onChange,
}: {
  draft: Draft;
  projects: Project[];
  hosts: Host[];
  git: GitCheck | undefined;
  onChange: (patch: Partial<Draft>) => void;
}) {
  const { data: probes } = useAgentStatusQuery();
  const real = projects.filter((p) => !p.is_uncategorized);
  const project = real.find((p) => p.id === draft.projectId) ?? null;
  // A task runs on another machine through that machine's own AgentOS, so
  // only linked ones; a scratch chat runs over ssh on any.
  const machines = draft.openPr
    ? hosts.filter((h) => h.id === "local" || Boolean(h.linked))
    : hosts;
  const host = hosts.find((h) => h.id === draft.hostId);
  const local = draft.hostId === "local";
  const base = draft.baseBranch ?? git?.defaultBranch ?? "main";
  // A project's sessions run where it lives; a scratch chat or a task can
  // go anywhere.
  const canMove = !project || draft.openPr;

  const pickProject = (id: string | null) => {
    const next = newDraft(draft.id, real.find((p) => p.id === id) ?? null, {
      agentType: draft.agentType,
      model: draft.model,
      access: draft.access,
    });
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
          label={host?.name ?? draft.hostId}
          disabled={!canMove}
          title={canMove ? undefined : "Runs where the project lives"}
        >
          {machines.map((h) => (
            <ChipItem
              key={h.id}
              checked={h.id === draft.hostId}
              onSelect={() =>
                onChange({
                  hostId: h.id,
                  useWorktree: h.id === "local" && !!project,
                })
              }
            >
              {h.name}
            </ChipItem>
          ))}
        </ChipMenu>
      )}

      {!draft.openPr && (
        <ChipMenu icon={Bot} name="Agent" label={agentLabel(draft.agentType)}>
          {AGENT_OPTIONS.map((o) => (
            <ChipItem
              key={o.value}
              checked={o.value === draft.agentType}
              disabled={probes?.[o.value] ? !probes[o.value].installed : false}
              hint={agentBlocker(probes?.[o.value]) ?? undefined}
              onSelect={() =>
                onChange({
                  agentType: o.value,
                  model: resolveModelForAgent(o.value, draft.model),
                })
              }
            >
              {o.label}
            </ChipItem>
          ))}
        </ChipMenu>
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
      {!draft.openPr && agentBlocker(probes?.[draft.agentType]) && (
        <p className="w-full text-xs text-amber-600 dark:text-amber-400">
          {agentBlocker(probes?.[draft.agentType])}
          {probes?.[draft.agentType]?.hint
            ? `: ${probes[draft.agentType].hint}`
            : ""}
        </p>
      )}
    </div>
  );
}

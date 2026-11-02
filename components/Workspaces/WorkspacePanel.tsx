"use client";

import { useUpdateWorkspace } from "@/data/workspaces";
import type { Workspace } from "@/lib/db";
import {
  NumberSetting,
  SwitchSetting,
} from "@/components/Settings/settings-fields";
import { SettingSection } from "@/components/Settings/SettingRow";
import { SETTING_DEFAULTS } from "@/lib/settings/defaults";
import { HqFolderForm } from "./HqFolderForm";
import { McpServersForm } from "./McpServersForm";
import { ProjectTiersForm } from "./ProjectTiersForm";
import { RulesForm } from "./RulesForm";
import { WorkspaceModeForm } from "./WorkspaceModeForm";
import { WorkspaceModelsForm } from "./WorkspaceModelsForm";

// One workspace's settings, in titled groups.
export function WorkspacePanel({ workspace: w }: { workspace: Workspace }) {
  const update = useUpdateWorkspace();
  return (
    <div aria-label={`${w.name} settings`} role="group">
      <SettingSection
        title="Limits & mode"
        help="Tasks over the limit wait in Queued and start by themselves, in order, when a running one finishes."
      >
        <NumberSetting
          id={`task-limit-${w.id}`}
          label="Tasks at a time"
          value={w.max_running_tasks ?? 0}
          defaultValue={0}
          onSave={(n) =>
            update.mutateAsync({
              id: w.id,
              maxRunningTasks: n === 0 ? null : n,
            })
          }
          min={1}
          integer
          unit="at a time"
          optional={{ off: 0, on: SETTING_DEFAULTS.taskLimitOn }}
        />
        <WorkspaceModeForm workspaceId={w.id} />
      </SettingSection>
      <SettingSection
        title="Orchestrator"
        help="What this workspace's orchestrator may do, which models it runs on, and where its session logs go."
      >
        <SwitchSetting
          id={`full-access-${w.id}`}
          label="Full access"
          help="Its shell and file writes aren't checked. Applies when its conversation next restarts."
          checked={w.orch_full_access}
          confirm="Let this orchestrator act without approval? It can push, commit, edit any repository or file on this machine, merge a PR directly, and edit .claude files. Off: the deny list, write limits and merge-only-through-the-gates apply."
          confirmLabel="Turn on full access"
          onSave={(on) => update.mutateAsync({ id: w.id, orchFullAccess: on })}
        />
        <SwitchSetting
          id={`wake-${w.id}`}
          label="Wake tasks on CI failures and reviews"
          help="A task's agent is messaged once when a check fails on its PR, and when someone reviews or comments."
          checked={w.wake_tasks_on_pr}
          onSave={(on) => update.mutateAsync({ id: w.id, wakeTasksOnPR: on })}
        />
        <WorkspaceModelsForm workspaceId={w.id} />
        <HqFolderForm workspaceId={w.id} />
      </SettingSection>
      <RulesForm workspaceId={w.id} />
      <McpServersForm workspace={w} />
      <ProjectTiersForm workspaceId={w.id} />
    </div>
  );
}

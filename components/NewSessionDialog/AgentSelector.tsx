import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { AgentType } from "@/lib/providers";
import type { AgentProbe } from "@/lib/agents/probe";
import { useAgentStatusQuery } from "@/data/agents";
import { AGENT_OPTIONS } from "./NewSessionDialog.types";

interface AgentSelectorProps {
  value: AgentType;
  onChange: (value: AgentType) => void;
}

// What stands between an agent and its first prompt, if anything.
function blocker(probe?: AgentProbe): string | null {
  if (!probe) return null;
  if (!probe.installed) return "Not installed";
  if (probe.auth === "needs-login") return "Needs sign-in";
  return null;
}

export function AgentSelector({ value, onChange }: AgentSelectorProps) {
  const { data: probes } = useAgentStatusQuery();
  const selected = probes?.[value];
  const problem = blocker(selected);
  return (
    <div className="space-y-2">
      <label className="text-sm font-medium">Agent</label>
      <Select value={value} onValueChange={(v) => onChange(v as AgentType)}>
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {AGENT_OPTIONS.map((option) => {
            const probe = probes?.[option.value];
            const note = blocker(probe);
            return (
              <SelectItem
                key={option.value}
                value={option.value}
                disabled={probe ? !probe.installed : false}
              >
                <span className="font-medium">{option.label}</span>
                <span className="text-muted-foreground ml-2 text-xs">
                  {note ?? option.description}
                </span>
              </SelectItem>
            );
          })}
        </SelectContent>
      </Select>
      {problem && (
        <p className="text-xs text-amber-600 dark:text-amber-400">
          {problem}
          {selected?.hint ? `: ${selected.hint}` : ""}
        </p>
      )}
    </div>
  );
}

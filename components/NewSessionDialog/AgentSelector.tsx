import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { AgentType } from "@/lib/providers";
import { AGENT_OPTIONS } from "./NewSessionDialog.types";

interface AgentSelectorProps {
  value: AgentType;
  onChange: (value: AgentType) => void;
}

export function AgentSelector({ value, onChange }: AgentSelectorProps) {
  return (
    <div className="space-y-2">
      <label className="text-sm font-medium">Agent</label>
      <Select value={value} onValueChange={(v) => onChange(v as AgentType)}>
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {AGENT_OPTIONS.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              <span className="font-medium">{option.label}</span>
              <span className="text-muted-foreground ml-2 text-xs">
                {option.description}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

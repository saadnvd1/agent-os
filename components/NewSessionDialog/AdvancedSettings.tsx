import { ChevronRight } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import type { AgentType } from "@/lib/providers";
import { getProviderDefinition } from "@/lib/providers";

interface AdvancedSettingsProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agentType: AgentType;
  useTmux: boolean;
  onUseTmuxChange: (checked: boolean) => void;
  skipPermissions: boolean;
  onSkipPermissionsChange: (checked: boolean) => void;
  initialPrompt: string;
  onInitialPromptChange: (value: string) => void;
}

export function AdvancedSettings({
  open,
  onOpenChange,
  agentType,
  useTmux,
  onUseTmuxChange,
  skipPermissions,
  onSkipPermissionsChange,
  initialPrompt,
  onInitialPromptChange,
}: AdvancedSettingsProps) {
  const provider = getProviderDefinition(agentType);

  return (
    <div className="border-border rounded-lg border">
      <button
        type="button"
        onClick={() => onOpenChange(!open)}
        className="text-muted-foreground hover:text-foreground flex w-full items-center gap-2 px-3 py-2 text-sm transition-colors"
      >
        <ChevronRight
          className={`h-4 w-4 transition-transform ${open ? "rotate-90" : ""}`}
        />
        Advanced Settings
      </button>
      {open && (
        <div className="space-y-3 border-t px-3 py-3">
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="useTmux"
              checked={useTmux}
              onChange={(e) => onUseTmuxChange(e.target.checked)}
              className="border-border bg-background accent-primary h-4 w-4 rounded"
            />
            <label htmlFor="useTmux" className="cursor-pointer text-sm">
              Use tmux session
              <span className="text-muted-foreground ml-1">
                (enables detach/attach)
              </span>
            </label>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="skipPermissions"
              checked={skipPermissions}
              onChange={(e) => onSkipPermissionsChange(e.target.checked)}
              className="border-border bg-background accent-primary h-4 w-4 rounded"
            />
            <label htmlFor="skipPermissions" className="cursor-pointer text-sm">
              Auto-approve tool calls
              <span className="text-muted-foreground ml-1">
                {provider.autoApproveFlag
                  ? `(${provider.autoApproveFlag})`
                  : "(not supported)"}
              </span>
            </label>
          </div>
          <div className="space-y-1.5 pt-2">
            <label htmlFor="initialPrompt" className="text-sm font-medium">
              Initial Prompt{" "}
              <span className="text-muted-foreground font-normal">
                (optional)
              </span>
            </label>
            <Textarea
              id="initialPrompt"
              value={initialPrompt}
              onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
                onInitialPromptChange(e.target.value)
              }
              placeholder="Enter a prompt to send when the session starts..."
              className="min-h-[80px] resize-none text-sm"
              rows={3}
            />
          </div>
        </div>
      )}
    </div>
  );
}

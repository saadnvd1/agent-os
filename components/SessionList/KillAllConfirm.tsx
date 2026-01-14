import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { sessionKeys } from "@/data/sessions/keys";

interface KillAllConfirmProps {
  onCancel: () => void;
  onComplete: () => void;
}

export function KillAllConfirm({ onCancel, onComplete }: KillAllConfirmProps) {
  const queryClient = useQueryClient();
  const [killing, setKilling] = useState(false);

  const handleKillAll = async () => {
    setKilling(true);
    try {
      await fetch("/api/tmux/kill-all", { method: "POST" });
      await queryClient.invalidateQueries({ queryKey: sessionKeys.list() });
      onComplete();
    } catch (error) {
      console.error("Failed to kill sessions:", error);
    } finally {
      setKilling(false);
    }
  };

  return (
    <div className="mx-4 mb-3 rounded-lg border border-red-500/20 bg-red-500/10 p-3">
      <p className="mb-2 text-sm text-red-400">Kill all tmux sessions?</p>
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="destructive"
          onClick={handleKillAll}
          disabled={killing}
        >
          {killing ? "Killing..." : "Yes, kill all"}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel} disabled={killing}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

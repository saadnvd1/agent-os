"use client";

import { Button } from "@/components/ui/button";
import { AgentList } from "@/components/Welcome/AgentList";
import { settingsUiActions } from "@/stores/settingsUi";
import { welcomeUiActions } from "@/stores/welcomeUi";

// What this machine has for running agents, and the first-run setup again.
export function SetupSection() {
  return (
    <div className="flex flex-col gap-4">
      <div className="bg-muted/40 flex items-center gap-3 rounded-lg px-3 py-2.5">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">First-run setup</p>
          <p className="text-muted-foreground text-xs">
            Agents, your first project, and a first session.
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="min-h-11 sm:min-h-8"
          onClick={() => {
            settingsUiActions.close();
            welcomeUiActions.open("agents");
          }}
        >
          Run setup again
        </Button>
      </div>
      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-medium">Agents on this machine</h3>
        <AgentList />
      </div>
    </div>
  );
}

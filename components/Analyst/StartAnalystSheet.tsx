"use client";

import { useState } from "react";
import { useSnapshot } from "valtio";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { RoleModelSelect } from "@/components/Models/RoleModelSelect";
import { analystUi, analystUiActions } from "@/stores/analystUi";
import { useStartAnalystBeside } from "./pair";

// Pairs an analyst with a chat: it reviews each turn the coding agent
// finishes and recommends the next prompt, which the user sends or not.
export function StartAnalystSheet() {
  const ui = useSnapshot(analystUi);
  return (
    <Dialog open={ui.open} onOpenChange={(o) => !o && analystUiActions.close()}>
      {ui.open && ui.sessionId && (
        <StartAnalystForm
          key={ui.sessionId}
          sessionId={ui.sessionId}
          name={ui.name}
          paneId={ui.paneId}
        />
      )}
    </Dialog>
  );
}

function StartAnalystForm({
  sessionId,
  name,
  paneId,
}: {
  sessionId: string;
  name: string;
  paneId: string | null;
}) {
  const [model, setModel] = useState<string | null>(null);
  const [reviewLast, setReviewLast] = useState(false);
  const start = useStartAnalystBeside();

  return (
    <DialogContent className="sm:max-w-[460px]">
      <DialogHeader>
        <DialogTitle>Add an analyst</DialogTitle>
        <DialogDescription>
          A second chat that reviews each turn of{" "}
          <span className="text-foreground font-medium">{name}</span>, explains
          it in plain English, flags issues and drafts the next prompt. Nothing
          reaches the coding agent until you press Send.
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-1.5">
        <label
          htmlFor="analyst-model"
          className="text-muted-foreground text-xs font-medium uppercase"
        >
          Analyst model
        </label>
        <RoleModelSelect
          id="analyst-model"
          value={model}
          inheritLabel="The analyst role's model"
          claudeOnly
          onChange={setModel}
        />
      </div>
      <label className="flex min-h-11 items-center justify-between gap-3 text-sm">
        <span>Review the last turn now</span>
        <Switch checked={reviewLast} onCheckedChange={setReviewLast} />
      </label>
      <div className="flex justify-end gap-2">
        <Button
          variant="ghost"
          className="h-11 md:h-9"
          onClick={() => analystUiActions.close()}
        >
          Cancel
        </Button>
        <Button
          className="h-11 md:h-9"
          disabled={start.isPending}
          onClick={async () => {
            const link = await start.run(
              {
                coderSessionId: sessionId,
                analystModel: model ?? undefined,
                reviewLast,
              },
              paneId ?? undefined
            );
            if (link) analystUiActions.close();
          }}
        >
          {start.isPending && <Loader2 className="animate-spin" />}
          Add analyst
        </Button>
      </div>
    </DialogContent>
  );
}

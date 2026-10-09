import { Info } from "lucide-react";

// Where a terminal or a new session would be, in a demo: what this is and
// what to look at instead. Fixed text; nothing runs.
export function DemoNotice() {
  return (
    <div className="flex h-full w-full items-center justify-center p-4">
      <div className="bg-card text-card-foreground border-border w-full max-w-md space-y-3 rounded-lg border p-5">
        <div className="flex items-center gap-2">
          <Info className="text-muted-foreground h-4 w-4 shrink-0" />
          <h2 className="text-sm font-semibold">This is a demo</h2>
        </div>
        <p className="text-muted-foreground text-sm leading-relaxed">
          Everything here is made-up data. Agents, terminals and new sessions
          don&apos;t run in the demo.
        </p>
        <p className="text-muted-foreground text-sm leading-relaxed">
          Open a session from the sidebar to read its chat, its changes and its
          pull request.
        </p>
      </div>
    </div>
  );
}

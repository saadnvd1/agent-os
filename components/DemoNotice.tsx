import { Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CONNECT_SIGN_UP } from "@/lib/connect/view";

const INSTALL_URL = "https://github.com/saadnvd1/agent-os#install";

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
          pull request; its terminal stays closed.
        </p>
        <div className="flex flex-wrap gap-2 pt-1">
          <Button asChild className="min-h-11 sm:min-h-9">
            <a href={INSTALL_URL} target="_blank" rel="noopener noreferrer">
              Install AgentOS
            </a>
          </Button>
          <Button asChild variant="outline" className="min-h-11 sm:min-h-9">
            <a href={CONNECT_SIGN_UP} target="_blank" rel="noopener noreferrer">
              Get Connect
            </a>
          </Button>
        </div>
      </div>
    </div>
  );
}

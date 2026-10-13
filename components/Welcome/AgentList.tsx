"use client";

import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAgentStatusQuery, useRecheckAgents } from "@/data/agents";
import { FEATURED_AGENTS } from "@/lib/agents/setup-commands";
import { getAllProviderDefinitions } from "@/lib/providers/registry";
import { AgentRow, type AgentRun } from "./AgentRow";
import { SetupTerminal } from "./SetupTerminal";

/**
 * Every agent CLI on this machine with what it needs, and an embedded
 * terminal to install or sign one in. Checks again when it opens and when a
 * terminal is closed, never on a timer.
 */
export function AgentList() {
  const { data: agents } = useAgentStatusQuery();
  const recheck = useRecheckAgents();
  const [run, setRun] = useState<(AgentRun & { key: number }) | null>(null);
  const [all, setAll] = useState(false);
  const { mutate } = recheck;

  useEffect(() => mutate(), [mutate]);

  const providers = getAllProviderDefinitions().filter((p) => p.cli);
  const shown = providers.filter((p) => all || FEATURED_AGENTS.includes(p.id));
  const hidden = providers.length - shown.length;

  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col gap-2">
        {shown.map((p) => (
          <AgentRow
            key={p.id}
            provider={p}
            probe={agents?.[p.id]}
            onRun={(r) => setRun({ ...r, key: Date.now() })}
          />
        ))}
      </ul>
      {run && (
        <SetupTerminal
          key={run.key}
          title={run.title}
          command={run.command}
          onDone={() => {
            setRun(null);
            mutate();
          }}
        />
      )}
      <div className="flex items-center justify-between gap-2">
        {hidden > 0 ? (
          <Button size="sm" variant="ghost" onClick={() => setAll(true)}>
            Show {hidden} more
          </Button>
        ) : (
          <span />
        )}
        <Button
          size="sm"
          variant="ghost"
          disabled={recheck.isPending}
          onClick={() => mutate()}
        >
          <RefreshCw className={recheck.isPending ? "animate-spin" : ""} />
          Check again
        </Button>
      </div>
    </div>
  );
}

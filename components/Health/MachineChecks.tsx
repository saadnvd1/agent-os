"use client";

import { HealthList } from "@/components/Welcome/HealthList";
import { AgentList } from "@/components/Welcome/AgentList";

// What this machine has for running AgentOS and agents.
export function MachineChecks() {
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold">Checks</h3>
        <HealthList />
      </div>
      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold">Agents on this machine</h3>
        <AgentList />
      </div>
    </div>
  );
}

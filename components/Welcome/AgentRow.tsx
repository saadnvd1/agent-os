"use client";

import { Check, Download, LogIn } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { AgentProbe } from "@/lib/agents/probe";
import { agentState, SETUP_COMMANDS } from "@/lib/agents/setup-commands";
import type { ProviderDefinition } from "@/lib/providers/registry";

const LABEL = {
  missing: "Not installed",
  "needs-login": "Needs sign-in",
  ready: "Ready",
  installed: "Installed",
} as const;

export type AgentRun = { title: string; command: string };

/** One agent CLI: its state, and the install or sign-in it needs. */
export function AgentRow({
  provider,
  probe,
  onRun,
}: {
  provider: ProviderDefinition;
  probe: AgentProbe | undefined;
  onRun: (run: AgentRun) => void;
}) {
  const state = probe ? agentState(probe) : null;
  const commands = SETUP_COMMANDS[provider.id];
  return (
    <li className="bg-muted/40 flex min-h-11 items-center gap-3 rounded-lg px-3 py-2">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{provider.name}</p>
        <p className="text-muted-foreground truncate text-xs">
          {probe?.version
            ? `v${probe.version}`
            : (probe?.hint ?? provider.description)}
        </p>
      </div>
      {!state && <Badge variant="outline">Checking</Badge>}
      {state === "ready" && (
        <Badge variant="success">
          <Check className="mr-1 size-3" />
          {LABEL.ready}
        </Badge>
      )}
      {state === "installed" && <Badge variant="outline">{LABEL[state]}</Badge>}
      {state === "needs-login" && (
        <>
          <Badge variant="secondary">{LABEL[state]}</Badge>
          {commands?.signIn && (
            <Button
              size="sm"
              variant="outline"
              className="min-h-11 sm:min-h-8"
              onClick={() =>
                onRun({
                  title: `Sign in to ${provider.name}`,
                  command: commands.signIn!,
                })
              }
            >
              <LogIn />
              Sign in
            </Button>
          )}
        </>
      )}
      {state === "missing" &&
        (commands?.install ? (
          <Button
            size="sm"
            variant="outline"
            className="min-h-11 sm:min-h-8"
            onClick={() =>
              onRun({
                title: `Install ${provider.name}`,
                command: commands.install!,
              })
            }
          >
            <Download />
            Install
          </Button>
        ) : commands?.docs ? (
          <Button
            size="sm"
            variant="outline"
            className="min-h-11 sm:min-h-8"
            asChild
          >
            <a href={commands.docs} target="_blank" rel="noreferrer">
              How to install
            </a>
          </Button>
        ) : (
          <Badge variant="outline">{LABEL.missing}</Badge>
        ))}
    </li>
  );
}

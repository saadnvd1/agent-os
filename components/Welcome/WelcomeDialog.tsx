"use client";

import { memo } from "react";
import { useSnapshot } from "valtio";
import { Check } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useProjectsQuery } from "@/data/projects/queries";
import { useEndWelcome, useWelcomeUrl } from "@/hooks/useWelcome";
import { cn } from "@/lib/utils";
import { WELCOME_STEPS, type WelcomeStep } from "@/lib/welcome-url";
import { welcomeUi, welcomeUiActions } from "@/stores/welcomeUi";
import { AgentList } from "./AgentList";
import { ProjectStep } from "./ProjectStep";

const STEPS: Record<
  WelcomeStep,
  { label: string; title: string; hint: string }
> = {
  agents: {
    label: "Agents",
    title: "Connect your agents",
    hint: "Install and sign in the coding agents you want to use. You need one.",
  },
  project: {
    label: "Project",
    title: "Add your first project",
    hint: "A folder or repo for the first session to work in.",
  },
  finish: {
    label: "Start",
    title: "You're set",
    hint: "Open a session in your project and give it a task.",
  },
};

function FinishStep() {
  const { projectId } = useSnapshot(welcomeUi);
  const { data: projects = [] } = useProjectsQuery();
  const project = projects.find((p) => p.id === projectId);
  return (
    <p className="text-muted-foreground bg-muted/40 rounded-lg px-3 py-3 text-sm">
      {project ? (
        <>
          First session opens in{" "}
          <span className="text-foreground font-medium">{project.name}</span>.
        </>
      ) : (
        "No project yet. Add one from the sidebar whenever you are ready."
      )}
    </p>
  );
}

/**
 * First-run setup: agents, then a first project, then a session. It stays
 * open until finished or skipped, and every step after the first can be skipped.
 */
export const WelcomeDialog = memo(function WelcomeDialog() {
  useWelcomeUrl();
  const { open, step, projectId } = useSnapshot(welcomeUi);
  const end = useEndWelcome();
  const at = WELCOME_STEPS.indexOf(step);
  const info = STEPS[step];
  const last = at === WELCOME_STEPS.length - 1;

  return (
    <Dialog open={open}>
      <DialogContent
        showCloseButton={false}
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
        className="max-h-[100dvh] overflow-y-auto max-sm:h-[100dvh] max-sm:max-w-full max-sm:rounded-none sm:max-h-[90dvh] sm:max-w-xl"
      >
        <nav aria-label="Setup steps" className="flex items-center gap-1">
          {WELCOME_STEPS.map((s, i) => (
            <button
              key={s}
              type="button"
              disabled={i === at}
              onClick={() => welcomeUiActions.go(s)}
              aria-current={i === at ? "step" : undefined}
              className={cn(
                "flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-lg px-2 text-xs font-medium sm:min-h-8",
                i === at
                  ? "bg-foreground/[0.08] text-foreground"
                  : "text-muted-foreground hover:bg-foreground/[0.06]"
              )}
            >
              {i < at && <Check className="size-3" />}
              {STEPS[s].label}
            </button>
          ))}
          <Button
            variant="ghost"
            size="sm"
            className="min-h-11 sm:min-h-8"
            onClick={() => end()}
          >
            Skip setup
          </Button>
        </nav>
        <div className="flex flex-col gap-1">
          <DialogTitle>{info.title}</DialogTitle>
          <DialogDescription>{info.hint}</DialogDescription>
        </div>
        {step === "agents" && <AgentList />}
        {step === "project" && <ProjectStep />}
        {step === "finish" && <FinishStep />}
        <div className="flex items-center justify-between gap-2">
          <Button
            variant="ghost"
            className="min-h-11 sm:min-h-9"
            disabled={at === 0}
            onClick={() => welcomeUiActions.go(WELCOME_STEPS[at - 1])}
          >
            Back
          </Button>
          <div className="flex items-center gap-2">
            {step === "project" && (
              <Button
                variant="ghost"
                className="min-h-11 sm:min-h-9"
                onClick={() => welcomeUiActions.go("finish")}
              >
                Skip
              </Button>
            )}
            <Button
              className="min-h-11 sm:min-h-9"
              onClick={() =>
                last ? end(true) : welcomeUiActions.go(WELCOME_STEPS[at + 1])
              }
            >
              {last
                ? projectId
                  ? "Start your first session"
                  : "Go to AgentOS"
                : step === "agents"
                  ? "Continue"
                  : "Next"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
});

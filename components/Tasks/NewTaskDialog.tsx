"use client";

import { useState } from "react";
import { useSnapshot } from "valtio";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useProjectsQuery } from "@/data/projects";
import { useLinkedHosts } from "@/data/hosts";
import { useCreateTask } from "@/data/tasks";
import { tasksUi, tasksUiActions } from "@/stores/tasksUi";

export function NewTaskDialog() {
  const { newOpen } = useSnapshot(tasksUi);
  const { data: projects = [] } = useProjectsQuery();
  const createTask = useCreateTask();
  const eligible = projects.filter(
    (p) => !p.is_uncategorized && (!p.host_id || p.host_id === "local")
  );
  const [projectId, setProjectId] = useState("");
  const [prompt, setPrompt] = useState("");
  const machines = useLinkedHosts();
  const [hostChoice, setHostId] = useState("local");
  // A machine unlinked since it was picked falls back to this one.
  const hostId = machines.some((h) => h.id === hostChoice)
    ? hostChoice
    : "local";

  // Default to the first project without an effect.
  const selected = projectId || eligible[0]?.id || "";

  const close = () => {
    tasksUiActions.closeNew();
    createTask.reset();
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    createTask.mutate(
      {
        projectId: selected,
        prompt,
        ...(hostId !== "local" && { hostId }),
      },
      {
        onSuccess: () => {
          setPrompt("");
          tasksUiActions.started();
        },
      }
    );
  };

  return (
    <Dialog open={newOpen} onOpenChange={(o) => !o && close()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>New task</DialogTitle>
          <DialogDescription>
            An agent works on it alone in a fresh worktree and opens a pull
            request when it&apos;s done. You review, then sign off to merge.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Project</label>
            <Select value={selected} onValueChange={setProjectId}>
              <SelectTrigger aria-label="Project">
                <SelectValue placeholder="Pick a project" />
              </SelectTrigger>
              <SelectContent>
                {eligible.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {machines.length > 0 && (
            <div className="space-y-2">
              <label className="text-sm font-medium">Run on</label>
              <Select value={hostId} onValueChange={setHostId}>
                <SelectTrigger aria-label="Run on">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="local">This machine</SelectItem>
                  {machines.map((h) => (
                    <SelectItem key={h.id} value={h.id}>
                      {h.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="space-y-2">
            <label className="text-sm font-medium">Task</label>
            <Textarea
              aria-label="Task"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="What should the agent do?"
              rows={6}
              autoFocus
            />
          </div>
          {createTask.error && (
            <p className="text-destructive text-sm">
              {createTask.error.message}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={close}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={!selected || !prompt.trim() || createTask.isPending}
            >
              {createTask.isPending ? "Starting..." : "Start task"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

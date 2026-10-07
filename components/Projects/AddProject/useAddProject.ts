"use client";

import { FolderOpen, FolderPlus, GitBranch, Monitor } from "lucide-react";
import { useHostsQuery } from "@/data/hosts";
import { paletteActions } from "@/stores/palette";
import { addProjectActions } from "@/stores/addProject";

const WAYS = [
  { kind: "folder", title: "Open a folder", icon: FolderOpen },
  { kind: "clone", title: "Clone from a URL", icon: GitBranch },
  { kind: "name", title: "New project from a name", icon: FolderPlus },
] as const;

// "Add project": pick the machine (when there's more than one), then how.
export function useAddProject() {
  const { data: hosts = [] } = useHostsQuery();
  const pickWay = (hostId: string, hostName?: string) =>
    paletteActions.pick(
      hostName ? `Add a project on ${hostName}…` : "Add a project…",
      WAYS.map((w) => ({
        id: `add-project.${w.kind}`,
        title: w.title,
        group: "",
        icon: w.icon,
        run: () => addProjectActions.show(w.kind, hostId),
      }))
    );
  return () => {
    if (hosts.length <= 1) return pickWay("local");
    paletteActions.pick(
      "Add a project on which machine?",
      hosts.map((h) => ({
        id: `add-project.host.${h.id}`,
        title: h.name,
        group: "",
        icon: Monitor,
        run: () => pickWay(h.id, h.name),
      }))
    );
  };
}

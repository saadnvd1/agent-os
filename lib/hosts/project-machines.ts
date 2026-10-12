import type { Project } from "../db";
import { projectRef } from "../tasks/project-ref";
import { projectOnPeers } from "./peer-actions";
import { linkedHostIds } from "./remote-api";

// Which linked machines can take a session for this project, and why not
// where one can't: { [hostId]: reason | null }.
export async function projectMachines(
  project: Project
): Promise<Record<string, string | null>> {
  if ((project.host_id || "local") !== "local") return {};
  try {
    return await projectOnPeers(await projectRef(project));
  } catch {
    // A project outside the home folder has no place on another machine.
    const reason = "Its folder is outside your home folder";
    return Object.fromEntries([...linkedHostIds()].map((id) => [id, reason]));
  }
}

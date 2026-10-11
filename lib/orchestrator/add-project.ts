import { getDefaultBranch } from "../git";
import { addFolder } from "../project-add";
import { addNote } from "./notes";

// add_project: a git repository on this machine becomes a project of this
// workspace, or the project already there, in no workspace, moves into it. Same path as the
// add dialog's, so the secrets refusal and the one-project-per-folder rule
// hold for both.
export async function addProject(
  w: string,
  target: string,
  name?: string
): Promise<string> {
  if (!/^(~|\/)/.test(target))
    throw new Error("Give the folder's absolute path (or one from ~)");
  const { project, outcome } = await addFolder("local", target, {
    workspaceId: w,
    name,
    moveExisting: true,
    moveOnlyUnassigned: true,
    requireGit: true,
  });
  const branch = await getDefaultBranch(project.working_directory).catch(
    () => null
  );
  const at = `${project.working_directory}${branch ? `, default branch ${branch}` : ""}`;
  if (outcome === "unchanged")
    return `${project.name} (${at}) is already in this workspace.`;
  const what =
    outcome === "created"
      ? `Added project ${project.name}`
      : `Moved project ${project.name} in from no workspace`;
  addNote(w, `${what} (${project.working_directory}).`);
  return `${what} (${at}).`;
}

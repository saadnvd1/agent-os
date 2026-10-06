import { randomUUID } from "crypto";
import os from "os";
import { db, queries, type Session } from "../db";
import { getProject, getAllProjects } from "../projects";
import { slugify } from "../git";
import { resolveModelForAgent } from "../model-catalog";
import { launchClaude } from "./launch";

// "dashboards" or a project id; case-insensitive on name.
export function findProject(ref: string) {
  const byId = getProject(ref);
  if (byId) return byId;
  const r = ref.trim().toLowerCase();
  const matches = getAllProjects().filter((p) => p.name.toLowerCase() === r);
  if (matches.length !== 1) {
    throw new Error(
      matches.length
        ? `"${ref}" matches several projects`
        : `No project called "${ref}"`
    );
  }
  return matches[0];
}

// An interactive Claude session in a project, started with a prompt, as if
// someone had opened it and typed. Agents use this to bring in help.
export async function spawnSession(opts: {
  project: string;
  prompt: string;
  model?: string;
}): Promise<Session> {
  const prompt = opts.prompt.trim();
  if (!prompt) throw new Error("Give the new session a prompt");
  const project = findProject(opts.project);
  if (project.is_uncategorized) throw new Error("Pick a real project");
  if (project.host_id && project.host_id !== "local") {
    throw new Error("Spawning on other machines isn't supported yet");
  }

  const id = randomUUID();
  const name = `${slugify(prompt.split(/\s+/).slice(0, 4).join(" "))}-${id.slice(0, 3)}`;
  const tmuxName = `claude-${id}`;
  const model = resolveModelForAgent(
    "claude",
    opts.model || project.default_model
  );
  const cwd = project.working_directory.replace(/^~/, os.homedir());

  queries
    .createSession(db)
    .run(
      id,
      name,
      tmuxName,
      cwd,
      null,
      model,
      null,
      "sessions",
      "claude",
      1,
      project.id,
      "local"
    );
  await launchClaude({ sessionId: id, tmuxName, cwd, model, prompt });
  return queries.getSession(db).get(id) as Session;
}

/**
 * Projects Module
 *
 * Projects are workspaces that contain sessions and dev server configurations.
 * Sessions inherit settings from their parent project.
 */

import { randomUUID } from "crypto";
import fs from "fs";
import path from "path";
import { exec } from "child_process";
import { promisify } from "util";
import {
  db,
  queries,
  type Project,
  type ProjectDevServer,
  type ProjectRepository,
  type Session,
  type DevServerType,
} from "./db";
import type { AgentType } from "./providers";

const execAsync = promisify(exec);

export interface CreateProjectOptions {
  name: string;
  workingDirectory: string;
  agentType?: AgentType;
  defaultModel?: string;
  initialPrompt?: string;
  devServers?: CreateDevServerOptions[];
}

export interface CreateDevServerOptions {
  name: string;
  type: DevServerType;
  command: string;
  port?: number;
  portEnvVar?: string;
}

export interface DetectedDevServer {
  name: string;
  type: DevServerType;
  command: string;
  port?: number;
  portEnvVar?: string;
}

export interface CreateRepositoryOptions {
  name: string;
  path: string;
  isPrimary?: boolean;
}

export interface ProjectWithDevServers extends Project {
  devServers: ProjectDevServer[];
}

export interface ProjectWithRepositories extends ProjectWithDevServers {
  repositories: ProjectRepository[];
}

// Generate project ID
function generateProjectId(): string {
  return `proj_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

// Generate dev server config ID
function generateDevServerId(): string {
  return `pds_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

// Generate repository config ID
function generateRepositoryId(): string {
  return `repo_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * Create a new project
 */
export function createProject(
  opts: CreateProjectOptions
): ProjectWithRepositories {
  const id = generateProjectId();

  // Get next sort order
  const projects = queries.getAllProjects(db).all() as Project[];
  const maxOrder = projects.reduce((max, p) => Math.max(max, p.sort_order), 0);

  queries
    .createProject(db)
    .run(
      id,
      opts.name,
      opts.workingDirectory,
      opts.agentType || "claude",
      opts.defaultModel || "sonnet",
      opts.initialPrompt || null,
      maxOrder + 1
    );

  // Create dev server configs if provided
  const devServers: ProjectDevServer[] = [];
  if (opts.devServers) {
    for (let i = 0; i < opts.devServers.length; i++) {
      const ds = opts.devServers[i];
      const dsId = generateDevServerId();
      queries
        .createProjectDevServer(db)
        .run(
          dsId,
          id,
          ds.name,
          ds.type,
          ds.command,
          ds.port || null,
          ds.portEnvVar || null,
          i
        );
      devServers.push({
        id: dsId,
        project_id: id,
        name: ds.name,
        type: ds.type,
        command: ds.command,
        port: ds.port || null,
        port_env_var: ds.portEnvVar || null,
        sort_order: i,
      });
    }
  }

  const project = queries.getProject(db).get(id) as Project;
  return {
    ...project,
    expanded: Boolean(project.expanded),
    is_uncategorized: Boolean(project.is_uncategorized),
    devServers,
    repositories: [],
  };
}

/**
 * Get a project by ID
 */
export function getProject(id: string): Project | undefined {
  const project = queries.getProject(db).get(id) as Project | undefined;
  if (!project) return undefined;
  return {
    ...project,
    expanded: Boolean(project.expanded),
    is_uncategorized: Boolean(project.is_uncategorized),
  };
}

/**
 * Get a project with its dev server configurations
 */
export function getProjectWithDevServers(
  id: string
): ProjectWithRepositories | undefined {
  const project = getProject(id);
  if (!project) return undefined;

  const devServers = queries
    .getProjectDevServers(db)
    .all(id) as ProjectDevServer[];
  const rawRepos = queries.getProjectRepositories(db).all(id) as (Omit<
    ProjectRepository,
    "is_primary"
  > & { is_primary: number })[];
  const repositories = rawRepos.map((r) => ({
    ...r,
    is_primary: Boolean(r.is_primary),
  }));
  return {
    ...project,
    devServers,
    repositories,
  };
}

/**
 * Get all projects (sorted by sort_order, with uncategorized last)
 */
export function getAllProjects(): Project[] {
  const projects = queries.getAllProjects(db).all() as Project[];
  return projects.map((p) => ({
    ...p,
    expanded: Boolean(p.expanded),
    is_uncategorized: Boolean(p.is_uncategorized),
  }));
}

/**
 * Get all projects with their dev server configurations
 */
export function getAllProjectsWithDevServers(): ProjectWithRepositories[] {
  const projects = getAllProjects();
  return projects.map((p) => {
    const devServers = queries
      .getProjectDevServers(db)
      .all(p.id) as ProjectDevServer[];
    const rawRepos = queries.getProjectRepositories(db).all(p.id) as (Omit<
      ProjectRepository,
      "is_primary"
    > & {
      is_primary: number;
    })[];
    const repositories = rawRepos.map((r) => ({
      ...r,
      is_primary: Boolean(r.is_primary),
    }));
    return {
      ...p,
      devServers,
      repositories,
    };
  });
}

/**
 * Update a project's settings
 */
export function updateProject(
  id: string,
  updates: Partial<
    Pick<
      Project,
      | "name"
      | "working_directory"
      | "agent_type"
      | "default_model"
      | "initial_prompt"
    >
  >
): Project | undefined {
  const project = getProject(id);
  if (!project || project.is_uncategorized) return undefined;

  queries
    .updateProject(db)
    .run(
      updates.name ?? project.name,
      updates.working_directory ?? project.working_directory,
      updates.agent_type ?? project.agent_type,
      updates.default_model ?? project.default_model,
      updates.initial_prompt !== undefined
        ? updates.initial_prompt
        : project.initial_prompt,
      id
    );

  return getProject(id);
}

/**
 * Toggle project expanded state
 */
export function toggleProjectExpanded(id: string, expanded: boolean): void {
  queries.updateProjectExpanded(db).run(expanded ? 1 : 0, id);
}

/**
 * Delete a project (moves sessions to Uncategorized)
 */
export function deleteProject(id: string): boolean {
  const project = getProject(id);
  if (!project || project.is_uncategorized) return false;

  // Move all sessions to Uncategorized
  const sessions = queries.getSessionsByProject(db).all(id) as Session[];
  for (const session of sessions) {
    queries.updateSessionProject(db).run("uncategorized", session.id);
  }

  // Delete dev server instances
  queries.deleteDevServersByProject(db).run(id);

  // Delete dev server configs (templates)
  queries.deleteProjectDevServers(db).run(id);

  // Delete project
  queries.deleteProject(db).run(id);
  return true;
}

/**
 * Get sessions for a project
 */
export function getProjectSessions(projectId: string): Session[] {
  return queries.getSessionsByProject(db).all(projectId) as Session[];
}

/**
 * Move a session to a project
 */
export function moveSessionToProject(
  sessionId: string,
  projectId: string
): void {
  queries.updateSessionProject(db).run(projectId, sessionId);
}

/**
 * Add a dev server configuration to a project
 */
export function addProjectDevServer(
  projectId: string,
  opts: CreateDevServerOptions
): ProjectDevServer {
  const id = generateDevServerId();

  // Get next sort order
  const existing = queries
    .getProjectDevServers(db)
    .all(projectId) as ProjectDevServer[];
  const maxOrder = existing.reduce(
    (max, ds) => Math.max(max, ds.sort_order),
    -1
  );

  queries
    .createProjectDevServer(db)
    .run(
      id,
      projectId,
      opts.name,
      opts.type,
      opts.command,
      opts.port || null,
      opts.portEnvVar || null,
      maxOrder + 1
    );

  return queries.getProjectDevServer(db).get(id) as ProjectDevServer;
}

/**
 * Update a dev server configuration
 */
export function updateProjectDevServer(
  id: string,
  updates: Partial<CreateDevServerOptions & { sortOrder?: number }>
): ProjectDevServer | undefined {
  const existing = queries.getProjectDevServer(db).get(id) as
    | ProjectDevServer
    | undefined;
  if (!existing) return undefined;

  queries
    .updateProjectDevServer(db)
    .run(
      updates.name ?? existing.name,
      updates.type ?? existing.type,
      updates.command ?? existing.command,
      updates.port ?? existing.port,
      updates.portEnvVar ?? existing.port_env_var,
      updates.sortOrder ?? existing.sort_order,
      id
    );

  return queries.getProjectDevServer(db).get(id) as ProjectDevServer;
}

/**
 * Delete a dev server configuration
 */
export function deleteProjectDevServer(id: string): void {
  queries.deleteProjectDevServer(db).run(id);
}

/**
 * Detect available npm scripts from package.json
 */
export async function detectNpmScripts(
  workingDir: string
): Promise<DetectedDevServer[]> {
  const expandedDir = workingDir.replace(/^~/, process.env.HOME || "~");
  const packageJsonPath = path.join(expandedDir, "package.json");

  if (!fs.existsSync(packageJsonPath)) return [];

  try {
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
    const scripts = packageJson.scripts || {};
    const detected: DetectedDevServer[] = [];

    // Common dev server scripts to look for
    const devScripts = [
      "dev",
      "start",
      "serve",
      "develop",
      "preview",
      "start:dev",
    ];

    for (const script of devScripts) {
      if (scripts[script]) {
        const scriptContent: string = scripts[script];

        // Try to detect port from script
        let port: number | undefined;
        const portMatch = scriptContent.match(/(?:port|PORT)[=\s]+(\d+)/i);
        if (portMatch) {
          port = parseInt(portMatch[1], 10);
        }

        // Detect port env var from common patterns
        let portEnvVar: string | undefined;
        if (
          scriptContent.includes("$PORT") ||
          scriptContent.includes("${PORT}")
        ) {
          portEnvVar = "PORT";
        }

        detected.push({
          name: `npm run ${script}`,
          type: "node",
          command: `npm run ${script}`,
          port,
          portEnvVar,
        });
      }
    }

    return detected;
  } catch {
    return [];
  }
}

/**
 * Detect Docker Compose services
 */
export async function detectDockerServices(
  workingDir: string
): Promise<DetectedDevServer[]> {
  const expandedDir = workingDir.replace(/^~/, process.env.HOME || "~");
  const composeFiles = [
    "docker-compose.yml",
    "docker-compose.yaml",
    "compose.yml",
    "compose.yaml",
  ];

  for (const file of composeFiles) {
    const composePath = path.join(expandedDir, file);
    if (fs.existsSync(composePath)) {
      try {
        const { stdout } = await execAsync(
          `docker compose -f "${file}" config --services 2>/dev/null || echo ""`,
          { cwd: expandedDir }
        );
        const services = stdout.trim().split("\n").filter(Boolean);

        return services.map((service) => ({
          name: service,
          type: "docker" as const,
          command: service,
        }));
      } catch {
        // Docker not available or compose file invalid
      }
    }
  }

  return [];
}

/**
 * Detect all available dev servers in a directory
 */
export async function detectDevServers(
  workingDir: string
): Promise<DetectedDevServer[]> {
  const [npmScripts, dockerServices] = await Promise.all([
    detectNpmScripts(workingDir),
    detectDockerServices(workingDir),
  ]);

  return [...npmScripts, ...dockerServices];
}

/**
 * Validate a working directory exists
 */
export function validateWorkingDirectory(dir: string): boolean {
  const expandedDir = dir.replace(/^~/, process.env.HOME || "~");
  try {
    return fs.existsSync(expandedDir) && fs.statSync(expandedDir).isDirectory();
  } catch {
    return false;
  }
}

// ============= Repository Management =============

/**
 * Get repositories for a project
 */
export function getProjectRepositories(projectId: string): ProjectRepository[] {
  const rawRepos = queries.getProjectRepositories(db).all(projectId) as (Omit<
    ProjectRepository,
    "is_primary"
  > & {
    is_primary: number;
  })[];
  return rawRepos.map((r) => ({
    ...r,
    is_primary: Boolean(r.is_primary),
  }));
}

/**
 * Add a repository to a project
 */
export function addProjectRepository(
  projectId: string,
  opts: CreateRepositoryOptions
): ProjectRepository {
  const id = generateRepositoryId();

  // Get next sort order
  const existing = getProjectRepositories(projectId);
  const maxOrder = existing.reduce(
    (max, repo) => Math.max(max, repo.sort_order),
    -1
  );

  // If this is the first repository or marked as primary, ensure no other is primary
  const isPrimary = opts.isPrimary || existing.length === 0;
  if (isPrimary) {
    // Clear primary flag from other repositories
    for (const repo of existing) {
      if (repo.is_primary) {
        queries
          .updateProjectRepository(db)
          .run(repo.name, repo.path, 0, repo.sort_order, repo.id);
      }
    }
  }

  queries
    .createProjectRepository(db)
    .run(id, projectId, opts.name, opts.path, isPrimary ? 1 : 0, maxOrder + 1);

  const raw = queries.getProjectRepository(db).get(id) as Omit<
    ProjectRepository,
    "is_primary"
  > & { is_primary: number };
  return {
    ...raw,
    is_primary: Boolean(raw.is_primary),
  };
}

/**
 * Update a repository
 */
export function updateProjectRepository(
  id: string,
  updates: Partial<CreateRepositoryOptions & { sortOrder?: number }>
): ProjectRepository | undefined {
  const raw = queries.getProjectRepository(db).get(id) as
    | (Omit<ProjectRepository, "is_primary"> & { is_primary: number })
    | undefined;
  if (!raw) return undefined;

  const existing = {
    ...raw,
    is_primary: Boolean(raw.is_primary),
  };

  // If setting as primary, clear other primaries
  const newIsPrimary =
    updates.isPrimary !== undefined ? updates.isPrimary : existing.is_primary;
  if (newIsPrimary && !existing.is_primary) {
    const allRepos = getProjectRepositories(existing.project_id);
    for (const repo of allRepos) {
      if (repo.is_primary && repo.id !== id) {
        queries
          .updateProjectRepository(db)
          .run(repo.name, repo.path, 0, repo.sort_order, repo.id);
      }
    }
  }

  queries
    .updateProjectRepository(db)
    .run(
      updates.name ?? existing.name,
      updates.path ?? existing.path,
      newIsPrimary ? 1 : 0,
      updates.sortOrder ?? existing.sort_order,
      id
    );

  const updatedRaw = queries.getProjectRepository(db).get(id) as Omit<
    ProjectRepository,
    "is_primary"
  > & { is_primary: number };
  return {
    ...updatedRaw,
    is_primary: Boolean(updatedRaw.is_primary),
  };
}

/**
 * Delete a repository
 */
export function deleteProjectRepository(id: string): void {
  queries.deleteProjectRepository(db).run(id);
}

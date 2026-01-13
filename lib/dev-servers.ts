import { spawn, exec } from "child_process";
import { promisify } from "util";
import fs from "fs";
import path from "path";
import { db, queries, DevServer, DevServerType, DevServerStatus } from "./db";

const execAsync = promisify(exec);

const LOGS_DIR = path.join(
  process.env.HOME || "~",
  ".agent-os",
  "logs"
);

// Ensure logs directory exists
if (!fs.existsSync(LOGS_DIR)) {
  fs.mkdirSync(LOGS_DIR, { recursive: true });
}

export interface StartServerOptions {
  projectId: string;
  type: DevServerType;
  name: string;
  command: string;
  workingDirectory: string;
  ports?: number[];
}

export interface DetectedServer {
  type: DevServerType;
  name: string;
  command: string;
  ports: number[];
}

// Generate unique ID
function generateId(): string {
  return `ds_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

// Get log file path for a server
export function getLogPath(serverId: string): string {
  return path.join(LOGS_DIR, `${serverId}.log`);
}

// Check if a process is running by PID
async function isPidRunning(pid: number): Promise<boolean> {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// Check if a port is in use
async function isPortInUse(port: number): Promise<boolean> {
  try {
    const { stdout } = await execAsync(`lsof -i :${port} -t 2>/dev/null || true`);
    return stdout.trim().length > 0;
  } catch {
    return false;
  }
}

// Get PID using a port
async function getPidOnPort(port: number): Promise<number | null> {
  try {
    const { stdout } = await execAsync(`lsof -i :${port} -t 2>/dev/null | head -1`);
    const pid = parseInt(stdout.trim(), 10);
    return isNaN(pid) ? null : pid;
  } catch {
    return null;
  }
}

// Check Node.js server status
async function checkNodeStatus(server: DevServer): Promise<DevServerStatus> {
  if (server.pid) {
    const running = await isPidRunning(server.pid);
    if (running) return "running";
  }

  // Check if any of its ports are in use
  const ports: number[] = JSON.parse(server.ports || "[]");
  for (const port of ports) {
    if (await isPortInUse(port)) {
      // Port is in use, try to get the PID
      const pid = await getPidOnPort(port);
      if (pid) {
        // Update PID in database
        queries.updateDevServerPid(db).run(pid, "running", server.id);
        return "running";
      }
    }
  }

  return "stopped";
}

// Check Docker service status
async function checkDockerStatus(server: DevServer): Promise<DevServerStatus> {
  if (!server.container_id) return "stopped";

  try {
    const { stdout } = await execAsync(
      `docker inspect -f '{{.State.Status}}' ${server.container_id} 2>/dev/null || echo ""`
    );
    const status = stdout.trim();
    if (status === "running") return "running";
    if (status === "starting" || status === "restarting") return "starting";
    return "stopped";
  } catch {
    return "stopped";
  }
}

// Get live status for a server
export async function getServerStatus(server: DevServer): Promise<DevServerStatus> {
  if (server.type === "docker") {
    return checkDockerStatus(server);
  }
  return checkNodeStatus(server);
}

// Get all servers with live status
export async function getAllServers(): Promise<DevServer[]> {
  const servers = queries.getAllDevServers(db).all() as DevServer[];

  // Update status for each server
  for (const server of servers) {
    const liveStatus = await getServerStatus(server);
    if (liveStatus !== server.status) {
      queries.updateDevServerStatus(db).run(liveStatus, server.id);
      server.status = liveStatus;
    }
  }

  return servers;
}

// Get servers for a project
export async function getServersByProject(projectId: string): Promise<DevServer[]> {
  const servers = queries.getDevServersByProject(db).all(projectId) as DevServer[];

  for (const server of servers) {
    const liveStatus = await getServerStatus(server);
    if (liveStatus !== server.status) {
      queries.updateDevServerStatus(db).run(liveStatus, server.id);
      server.status = liveStatus;
    }
  }

  return servers;
}

// Expand ~ to home directory
function expandHome(filePath: string): string {
  if (filePath.startsWith("~/")) {
    return path.join(process.env.HOME || "", filePath.slice(2));
  }
  return filePath;
}

// Start a Node.js server
async function spawnNodeServer(
  id: string,
  command: string,
  workingDirectory: string,
  ports: number[]
): Promise<{ pid: number }> {
  const logPath = getLogPath(id);
  // Open log file for appending (get file descriptor for spawn)
  const logFd = fs.openSync(logPath, "a");

  // Expand ~ to absolute path - Node.js spawn doesn't handle tilde
  const cwd = expandHome(workingDirectory);

  // Set up environment with port if specified
  const env = { ...process.env };
  if (ports.length > 0) {
    env.PORT = String(ports[0]);
  }

  // Use shell: true to resolve npm/yarn/pnpm from PATH (nvm, volta, etc.)
  const child = spawn(command, [], {
    cwd,
    env: env as NodeJS.ProcessEnv,
    shell: true,
    detached: true,
    stdio: ["ignore", logFd, logFd],
  });

  if (child.pid) child.unref();

  // Close our reference to the fd - the child process has its own
  fs.closeSync(logFd);

  // Give it a moment to start
  await new Promise((resolve) => setTimeout(resolve, 500));

  return { pid: child.pid || 0 };
}

// Start a Docker Compose service
async function spawnDockerService(
  command: string,
  workingDirectory: string
): Promise<{ containerId: string | null }> {
  try {
    // command is expected to be the service name
    await execAsync(`docker compose up -d ${command}`, { cwd: workingDirectory });

    // Get container ID
    const { stdout } = await execAsync(
      `docker compose ps -q ${command} 2>/dev/null || echo ""`,
      { cwd: workingDirectory }
    );
    const containerId = stdout.trim() || null;

    return { containerId };
  } catch (error) {
    console.error("Failed to start Docker service:", error);
    return { containerId: null };
  }
}

// Start a server
export async function startServer(opts: StartServerOptions): Promise<DevServer> {
  const id = generateId();
  const ports = opts.ports || [];

  // Create database record first
  queries.createDevServer(db).run(
    id,
    opts.projectId,
    opts.type,
    opts.name,
    opts.command,
    "starting",
    null, // pid
    null, // container_id
    JSON.stringify(ports),
    opts.workingDirectory
  );

  try {
    if (opts.type === "docker") {
      const { containerId } = await spawnDockerService(opts.command, opts.workingDirectory);
      queries.updateDevServer(db).run("running", null, containerId, JSON.stringify(ports), id);
    } else {
      const { pid } = await spawnNodeServer(id, opts.command, opts.workingDirectory, ports);
      queries.updateDevServer(db).run("running", pid, null, JSON.stringify(ports), id);
    }
  } catch (error) {
    queries.updateDevServerStatus(db).run("failed", id);
    throw error;
  }

  return queries.getDevServer(db).get(id) as DevServer;
}

// Stop a server
export async function stopServer(id: string): Promise<void> {
  const server = queries.getDevServer(db).get(id) as DevServer | undefined;
  if (!server) return;

  if (server.type === "docker") {
    if (server.container_id) {
      try {
        await execAsync(`docker stop ${server.container_id}`);
      } catch {
        // Container may already be stopped
      }
    }
  } else {
    if (server.pid) {
      try {
        process.kill(server.pid, "SIGTERM");
        // Give it time to gracefully shut down
        await new Promise((resolve) => setTimeout(resolve, 1000));
        // Force kill if still running
        if (await isPidRunning(server.pid)) {
          process.kill(server.pid, "SIGKILL");
        }
      } catch {
        // Process may already be dead
      }
    }

    // Also check ports and kill anything on them
    const ports: number[] = JSON.parse(server.ports || "[]");
    for (const port of ports) {
      const pid = await getPidOnPort(port);
      if (pid) {
        try {
          process.kill(pid, "SIGTERM");
        } catch {
          // Ignore
        }
      }
    }
  }

  queries.updateDevServerStatus(db).run("stopped", id);
}

// Restart a server
export async function restartServer(id: string): Promise<DevServer> {
  const server = queries.getDevServer(db).get(id) as DevServer | undefined;
  if (!server) throw new Error("Server not found");

  await stopServer(id);

  // Re-start with same config
  if (server.type === "docker") {
    const { containerId } = await spawnDockerService(server.command, server.working_directory);
    queries.updateDevServer(db).run("running", null, containerId, server.ports, id);
  } else {
    const ports: number[] = JSON.parse(server.ports || "[]");
    const { pid } = await spawnNodeServer(id, server.command, server.working_directory, ports);
    queries.updateDevServer(db).run("running", pid, null, server.ports, id);
  }

  return queries.getDevServer(db).get(id) as DevServer;
}

// Remove a server (stop and delete)
export async function removeServer(id: string): Promise<void> {
  await stopServer(id);
  queries.deleteDevServer(db).run(id);

  // Clean up log file
  const logPath = getLogPath(id);
  if (fs.existsSync(logPath)) {
    fs.unlinkSync(logPath);
  }
}

// Get logs for a server
export async function getServerLogs(id: string, lines = 100): Promise<string[]> {
  const server = queries.getDevServer(db).get(id) as DevServer | undefined;
  if (!server) return [];

  if (server.type === "docker" && server.container_id) {
    try {
      const { stdout } = await execAsync(
        `docker logs --tail ${lines} ${server.container_id} 2>&1`
      );
      return stdout.split("\n");
    } catch {
      return [];
    }
  }

  // Node.js server - read log file
  const logPath = getLogPath(id);
  if (!fs.existsSync(logPath)) return [];

  try {
    const content = fs.readFileSync(logPath, "utf-8");
    const allLines = content.split("\n");
    return allLines.slice(-lines);
  } catch {
    return [];
  }
}

// Detect available Node.js dev server in a directory
export async function detectNodeServer(workingDir: string): Promise<DetectedServer | null> {
  const packageJsonPath = path.join(workingDir, "package.json");
  if (!fs.existsSync(packageJsonPath)) return null;

  try {
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
    const scripts = packageJson.scripts || {};

    // Look for common dev server scripts
    const devScripts = ["dev", "start", "serve", "develop"];
    for (const script of devScripts) {
      if (scripts[script]) {
        // Try to detect port from script
        const scriptContent = scripts[script];
        let port = 3000; // default
        const portMatch = scriptContent.match(/(?:port|PORT)[=\s]+(\d+)/i);
        if (portMatch) {
          port = parseInt(portMatch[1], 10);
        }

        return {
          type: "node",
          name: packageJson.name || path.basename(workingDir),
          command: `npm run ${script}`,
          ports: [port],
        };
      }
    }
  } catch {
    // Ignore parse errors
  }

  return null;
}

// Detect Docker Compose services in a directory
export async function detectDockerServices(workingDir: string): Promise<DetectedServer[]> {
  const composeFiles = ["docker-compose.yml", "docker-compose.yaml", "compose.yml", "compose.yaml"];

  for (const file of composeFiles) {
    const composePath = path.join(workingDir, file);
    if (fs.existsSync(composePath)) {
      try {
        const { stdout } = await execAsync(
          `docker compose -f ${file} config --services 2>/dev/null || echo ""`,
          { cwd: workingDir }
        );
        const services = stdout.trim().split("\n").filter(Boolean);

        return services.map((service) => ({
          type: "docker" as const,
          name: service,
          command: service,
          ports: [], // Would need to parse compose file for ports
        }));
      } catch {
        // Docker not available or compose file invalid
      }
    }
  }

  return [];
}

// Detect all available servers in a directory
export async function detectServers(workingDir: string): Promise<DetectedServer[]> {
  const servers: DetectedServer[] = [];

  const nodeServer = await detectNodeServer(workingDir);
  if (nodeServer) {
    servers.push(nodeServer);
  }

  const dockerServices = await detectDockerServices(workingDir);
  servers.push(...dockerServices);

  return servers;
}

// Clean up orphaned servers on startup
export async function cleanupOrphanedServers(): Promise<void> {
  const servers = queries.getAllDevServers(db).all() as DevServer[];

  for (const server of servers) {
    const liveStatus = await getServerStatus(server);
    if (server.status === "running" && liveStatus === "stopped") {
      // Server was running but is now dead
      queries.updateDevServerStatus(db).run("stopped", server.id);
    }
  }
}

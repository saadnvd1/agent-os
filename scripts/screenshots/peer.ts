import http from "http";
import { PEER_PORT } from "./config";

// A stand-in for a linked machine's own AgentOS: the demo links a machine
// named devbox to it, and it lists a few sessions of its own, so the
// sidebar shows another machine's sessions next to local ones. It answers
// the reads a linked machine is asked for and refuses everything else.

export const PEER_HOST = { id: "devbox", name: "devbox", ssh: "alex@devbox" };

const ago = (minutes: number) =>
  new Date(Date.now() - minutes * 60000)
    .toISOString()
    .slice(0, 19)
    .replace("T", " ");

const SESSIONS = [
  {
    id: "7d3e9a10-5b2c-4f81-9e6a-1c0b2d3e4f50",
    name: "gpu-batch-sizes",
    path: "~/code/ml-pipeline",
    minutes: 4,
    status: "running",
  },
  {
    id: "8e4fab21-6c3d-4a92-8f7b-2d1c3e4f5a61",
    name: "nightly-eval-report",
    path: "~/code/ml-pipeline",
    minutes: 38,
    status: "waiting",
  },
  {
    id: "9f50bc32-7d4e-4ba3-9a8c-3e2d4f5a6b72",
    name: "terraform-plan",
    path: "~/code/infra",
    minutes: 95,
    status: "idle",
  },
];

function listing() {
  return SESSIONS.map((s) => ({
    id: s.id,
    name: s.name,
    tmux_name: `claude-${s.id}`,
    working_directory: s.path,
    view: "chat",
    agent_type: "claude",
    model: "opus",
    updated_at: ago(s.minutes),
  }));
}

function answer(url: string): unknown {
  const path = url.split("?")[0];
  if (path === "/api/sessions") return { sessions: listing() };
  if (path === "/api/sessions/status")
    return {
      statuses: Object.fromEntries(
        SESSIONS.map((s) => [s.id, { status: s.status }])
      ),
    };
  if (path === "/api/tmux/discover") return { sessions: [] };
  return null;
}

export function startPeer(): http.Server {
  const server = http.createServer((req, res) => {
    const body = req.method === "GET" ? answer(req.url ?? "") : null;
    res.writeHead(body ? 200 : 404, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body ?? { error: "Not available in the demo" }));
  });
  // Loopback only, like the demo server.
  server.listen(PEER_PORT, "127.0.0.1");
  return server;
}

#!/usr/bin/env npx ts-node
/**
 * MCP Server for Session Orchestration
 *
 * Exposes tools for any Claude session to become a "conductor" that spawns
 * and manages worker sessions. Each worker gets its own git worktree.
 *
 * Setup (one-time, in ~/.claude/settings.json or project .mcp.json):
 *   {
 *     "mcpServers": {
 *       "agent-os": {
 *         "command": "npx",
 *         "args": ["tsx", "/path/to/agent-os/mcp/orchestration-server.ts"],
 *         "env": {
 *           "AGENTOS_URL": "http://localhost:3011"
 *         }
 *       }
 *     }
 *   }
 *
 * Usage: Any session can spawn workers by calling spawn_worker with its own
 * session ID as conductorId. The UI will show the conductor/worker hierarchy.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const AGENTOS_URL = process.env.AGENTOS_URL || "http://localhost:3011";

// Optional: Get conductor session ID from environment (can also be passed per-call)
const DEFAULT_CONDUCTOR_ID = process.env.CONDUCTOR_SESSION_ID || "";

async function apiCall(path: string, options?: RequestInit) {
  const url = `${AGENTOS_URL}${path}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });
  return response.json();
}

const server = new Server(
  {
    name: "agent-os-orchestration",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "spawn_worker",
        description:
          "Spawn a new worker session to handle a task. Creates an isolated git worktree for the worker.",
        inputSchema: {
          type: "object" as const,
          properties: {
            conductorId: {
              type: "string",
              description:
                "Your session ID (the conductor). Required unless CONDUCTOR_SESSION_ID env var is set.",
            },
            task: {
              type: "string",
              description: "The task/prompt to send to the worker",
            },
            workingDirectory: {
              type: "string",
              description:
                "The git repository path for the worker to operate in",
            },
            branchName: {
              type: "string",
              description:
                "Optional branch name for the worktree (auto-generated if not provided)",
            },
            useWorktree: {
              type: "boolean",
              description:
                "Whether to create an isolated worktree (default: true)",
              default: true,
            },
            model: {
              type: "string",
              description: "Model to use (sonnet, opus, haiku)",
              default: "sonnet",
            },
          },
          required: ["task", "workingDirectory"],
        },
      },
      {
        name: "list_workers",
        description: "List all worker sessions spawned by a conductor",
        inputSchema: {
          type: "object" as const,
          properties: {
            conductorId: {
              type: "string",
              description:
                "The conductor session ID. Required unless CONDUCTOR_SESSION_ID env var is set.",
            },
          },
        },
      },
      {
        name: "get_worker_output",
        description: "Get recent terminal output from a worker",
        inputSchema: {
          type: "object" as const,
          properties: {
            workerId: {
              type: "string",
              description: "The worker session ID",
            },
            lines: {
              type: "number",
              description: "Number of lines to retrieve (default: 50)",
              default: 50,
            },
          },
          required: ["workerId"],
        },
      },
      {
        name: "send_to_worker",
        description: "Send a message or command to a worker",
        inputSchema: {
          type: "object" as const,
          properties: {
            workerId: {
              type: "string",
              description: "The worker session ID",
            },
            message: {
              type: "string",
              description: "The message to send",
            },
          },
          required: ["workerId", "message"],
        },
      },
      {
        name: "complete_worker",
        description: "Mark a worker as completed (task finished successfully)",
        inputSchema: {
          type: "object" as const,
          properties: {
            workerId: {
              type: "string",
              description: "The worker session ID",
            },
          },
          required: ["workerId"],
        },
      },
      {
        name: "kill_worker",
        description:
          "Kill a worker session and optionally clean up its worktree",
        inputSchema: {
          type: "object" as const,
          properties: {
            workerId: {
              type: "string",
              description: "The worker session ID",
            },
            cleanupWorktree: {
              type: "boolean",
              description: "Whether to delete the worktree (default: false)",
              default: false,
            },
          },
          required: ["workerId"],
        },
      },
      {
        name: "get_workers_summary",
        description: "Get a summary count of workers by status",
        inputSchema: {
          type: "object" as const,
          properties: {
            conductorId: {
              type: "string",
              description:
                "The conductor session ID. Required unless CONDUCTOR_SESSION_ID env var is set.",
            },
          },
        },
      },
    ],
  };
});

// Helper to get conductor ID from args or env
function getConductorId(
  args: Record<string, unknown> | undefined
): string | null {
  return (args?.conductorId as string) || DEFAULT_CONDUCTOR_ID || null;
}

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case "spawn_worker": {
        const conductorId = getConductorId(args);
        if (!conductorId) {
          return {
            content: [
              {
                type: "text" as const,
                text: "Error: conductorId is required. Pass it as a parameter or set CONDUCTOR_SESSION_ID env var.",
              },
            ],
          };
        }
        const result = await apiCall("/api/orchestrate/spawn", {
          method: "POST",
          body: JSON.stringify({
            conductorSessionId: conductorId,
            task: args?.task,
            workingDirectory: args?.workingDirectory,
            branchName: args?.branchName,
            useWorktree: args?.useWorktree ?? true,
            model: args?.model || "sonnet",
          }),
        });
        return {
          content: [
            {
              type: "text" as const,
              text: result.error
                ? `Error: ${result.error}`
                : `Worker spawned successfully!\nID: ${result.session.id}\nName: ${result.session.name}\nWorktree: ${result.session.worktree_path || "none"}`,
            },
          ],
        };
      }

      case "list_workers": {
        const conductorId = getConductorId(args);
        if (!conductorId) {
          return {
            content: [
              {
                type: "text" as const,
                text: "Error: conductorId is required. Pass it as a parameter or set CONDUCTOR_SESSION_ID env var.",
              },
            ],
          };
        }
        const result = await apiCall(
          `/api/orchestrate/workers?conductorId=${conductorId}`
        );
        if (result.error) {
          return {
            content: [
              { type: "text" as const, text: `Error: ${result.error}` },
            ],
          };
        }
        const workers = result.workers || [];
        if (workers.length === 0) {
          return {
            content: [
              { type: "text" as const, text: "No workers spawned yet." },
            ],
          };
        }
        const list = workers
          .map(
            (w: {
              id: string;
              name: string;
              status: string;
              task: string;
              branchName: string | null;
            }) =>
              `- [${w.status.toUpperCase()}] ${w.name} (${w.id.slice(0, 8)})\n  Task: ${w.task}\n  Branch: ${w.branchName || "none"}`
          )
          .join("\n\n");
        return {
          content: [{ type: "text" as const, text: `Workers:\n\n${list}` }],
        };
      }

      case "get_worker_output": {
        const result = await apiCall(
          `/api/orchestrate/workers/${args?.workerId}?lines=${args?.lines || 50}`
        );
        return {
          content: [
            {
              type: "text" as const,
              text: result.error
                ? `Error: ${result.error}`
                : result.output || "(no output)",
            },
          ],
        };
      }

      case "send_to_worker": {
        const result = await apiCall(
          `/api/orchestrate/workers/${args?.workerId}`,
          {
            method: "POST",
            body: JSON.stringify({
              action: "send",
              message: args?.message,
            }),
          }
        );
        return {
          content: [
            {
              type: "text" as const,
              text: result.error
                ? `Error: ${result.error}`
                : "Message sent successfully.",
            },
          ],
        };
      }

      case "complete_worker": {
        const result = await apiCall(
          `/api/orchestrate/workers/${args?.workerId}`,
          {
            method: "POST",
            body: JSON.stringify({ action: "complete" }),
          }
        );
        return {
          content: [
            {
              type: "text" as const,
              text: result.error
                ? `Error: ${result.error}`
                : "Worker marked as completed.",
            },
          ],
        };
      }

      case "kill_worker": {
        const cleanup = args?.cleanupWorktree ? "?cleanup=true" : "";
        const result = await apiCall(
          `/api/orchestrate/workers/${args?.workerId}${cleanup}`,
          { method: "DELETE" }
        );
        return {
          content: [
            {
              type: "text" as const,
              text: result.error
                ? `Error: ${result.error}`
                : "Worker killed successfully.",
            },
          ],
        };
      }

      case "get_workers_summary": {
        const conductorId = getConductorId(args);
        if (!conductorId) {
          return {
            content: [
              {
                type: "text" as const,
                text: "Error: conductorId is required. Pass it as a parameter or set CONDUCTOR_SESSION_ID env var.",
              },
            ],
          };
        }
        const result = await apiCall(
          `/api/orchestrate/workers?conductorId=${conductorId}&summary=true`
        );
        if (result.error) {
          return {
            content: [
              { type: "text" as const, text: `Error: ${result.error}` },
            ],
          };
        }
        const s = result.summary;
        return {
          content: [
            {
              type: "text" as const,
              text: `Workers Summary:\n- Total: ${s.total}\n- Pending: ${s.pending}\n- Running: ${s.running}\n- Waiting: ${s.waiting}\n- Completed: ${s.completed}\n- Failed: ${s.failed}`,
            },
          ],
        };
      }

      default:
        return {
          content: [{ type: "text" as const, text: `Unknown tool: ${name}` }],
        };
    }
  } catch (error) {
    return {
      content: [
        {
          type: "text" as const,
          text: `Error: ${error instanceof Error ? error.message : "Unknown error"}`,
        },
      ],
    };
  }
});

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Agent-OS Orchestration MCP Server started");
}

main().catch(console.error);

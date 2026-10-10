// How this server's children reach it. A server started from inside
// another AgentOS's session (a test instance) inherits that one's AGENTOS_*
// variables; left alone, its agents would talk to the other instance.

export function selfUrl(env: NodeJS.ProcessEnv = process.env): string {
  return `http://127.0.0.1:${env.AGENTOS_PORT || env.PORT || "3011"}`;
}

// The server is no session: each child gets its own id from agentEnv.
export function claimAgentosEnv(
  port: number,
  env: NodeJS.ProcessEnv = process.env
): void {
  env.AGENTOS_PORT = String(port);
  env.AGENTOS_URL = selfUrl(env);
  delete env.AGENTOS_SESSION_ID;
}

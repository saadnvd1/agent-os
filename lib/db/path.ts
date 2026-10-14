import path from "path";

export const dbPath = (): string =>
  process.env.DB_PATH || path.join(process.cwd(), "agent-os.db");

// Where AgentOS keeps its own files beside the database.
export const dataRoot = (): string => path.dirname(path.resolve(dbPath()));

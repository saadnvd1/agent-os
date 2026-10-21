// A TCP listener in this machine's network namespace. Under WSL 2 that
// includes Windows, whose processes have no cwd we can read.
export interface Listener {
  port: number;
  pid: number | null;
  command: string | null;
  cwd: string | null;
  windows?: boolean;
}

export type Holder =
  | {
      kind: "session";
      sessionId: string;
      name: string;
      project: string | null;
      pid: number | null;
      listening: boolean;
    }
  | { kind: "dev-server"; id: string; name: string; pid: number | null }
  | {
      kind: "outside";
      pid: number | null;
      command: string | null;
      cwd: string | null;
    }
  | { kind: "windows"; pid: number | null };

// What a session could be told about one of its ports, or one it wants.
export interface PortCheck {
  name: string | null;
  port: number;
  // null: this machine can't be asked (no lsof).
  free: boolean | null;
  holder: Holder | null;
  // The holder is the asking session itself.
  mine: boolean;
}

export interface SessionPortRow {
  id: string;
  name: string;
  project: string | null;
  worktree: string | null;
  ports: Record<string, number> | null;
  devServerPort: number | null;
}

export interface DevServerPortRow {
  id: string;
  name: string;
  pid: number | null;
  ports: number[];
}

export interface HardcodedPort {
  // Where it is: "package.json dev", "agentos.json dev", "vite.config.ts".
  where: string;
  port: number;
  // The command with the session's port in place, when one can be given.
  fix: string | null;
}

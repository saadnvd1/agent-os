export interface InstanceRecord {
  pid: number;
  port: number;
  cwd: string;
  startedAt: number;
}

export interface DevRecord extends InstanceRecord {
  log: string;
}

// The port the server falls back to with no PORT or -p.
export const DEFAULT_PORT = 3011;

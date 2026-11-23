export interface Proc {
  pid: number;
  ppid: number;
  pgid: number;
  // Null when it can't be read (another user's process, or it just exited).
  cwd: string | null;
  command: string;
}

export interface Stopped {
  pid: number;
  command: string;
}

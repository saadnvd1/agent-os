import { execFile } from "child_process";

// Disk use of a folder in bytes; 0 when it can't be measured in time.
export default function duBytes(
  dir: string,
  timeout = 300_000
): Promise<number> {
  return new Promise((resolve) =>
    execFile("du", ["-sk", dir], { timeout }, (error, stdout) =>
      resolve(error ? 0 : (parseInt(String(stdout), 10) || 0) * 1024)
    )
  );
}

// Versions as AgentOS publishes them: MAJOR.MINOR.<commits on the default
// branch>. Pure, so a native client can use the same comparison.

/** "1.2.3" or "v1.2.3" as numbers; null for anything else (a pre-release, text). */
export function parseVersion(text: string): number[] | null {
  const m = /^v?(\d+(?:\.\d+){0,3})$/.exec(text.trim());
  return m ? m[1].split(".").map(Number) : null;
}

/** -1, 0 or 1; a missing segment is 0. Null when either side isn't a version. */
export function compareVersions(a: string, b: string): -1 | 0 | 1 | null {
  const x = parseVersion(a);
  const y = parseVersion(b);
  if (!x || !y) return null;
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d) return d < 0 ? -1 : 1;
  }
  return 0;
}

export const isNewer = (latest: string, current: string): boolean =>
  compareVersions(latest, current) === 1;

/** The version of a commit: package.json's "major.minor" and the commit count. */
export function versionFor(packageVersion: string, commitCount: number) {
  const parts = parseVersion(packageVersion);
  if (!parts) return null;
  return `${parts[0]}.${parts[1] ?? 0}.${commitCount}`;
}

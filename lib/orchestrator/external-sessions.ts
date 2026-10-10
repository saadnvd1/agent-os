/**
 * Sessions AgentOS didn't start that work in this workspace's projects: tmux
 * sessions found on this machine, a machine it reaches over ssh, or a linked
 * machine (the same discovery as the sidebar's "Elsewhere"), whose folder is
 * one of the workspace's projects or a clone or worktree of its
 * repository. `sessions` lists them read-only with the PR their branch has,
 * and `read` reads their screen; nothing sends to, stops or finishes them.
 */

import os from "os";
import { getDb, queries, type Project, type Session } from "../db";
import { discoverSessions } from "../hosts/discover";
import { getHost, hostExec } from "../hosts";
import { hostLink } from "../hosts/remote-api";
import { isValidTmuxName } from "../hosts/tmux-name";
import { shellQuote } from "../hosts/ssh";
import { statusDetector } from "../status-detector";
import { run } from "../tasks/gh";
import { workspaceProjects } from "./brief";
import { slugOfRemote, workspaceRepos } from "./repo-slug";
import { untrusted } from "./untrusted";

export interface ExternalSession {
  hostId: string;
  host: string;
  // tmux's name for it; `ref` is how read takes it.
  name: string;
  ref: string;
  path: string;
  project: string;
  // How it was matched: its folder is the project's, its clone's origin is
  // the project's repository, or (on a linked machine, whose folders aren't
  // read over ssh) its folder is named after the repository.
  matched: "folder" | "repository" | "folder name";
  branch: string | null;
  pr: { number: number; url: string; slug: string } | null;
  // Seconds.
  lastActive: number;
  title: string;
}

const PROBE_TTL_MS = 60_000;
const probes = new Map<string, { at: number; url: string; branch: string }>();
const prs = new Map<string, { at: number; pr: ExternalSession["pr"] }>();

const key = (hostId: string, path: string) => `${hostId}\t${path}`;

// Each folder's origin URL and branch, one shell per machine, cached.
async function probe(
  hostId: string,
  paths: string[]
): Promise<Map<string, { url: string; branch: string }>> {
  const now = Date.now();
  const out = new Map<string, { url: string; branch: string }>();
  const ask: string[] = [];
  for (const p of new Set(paths)) {
    const hit = probes.get(key(hostId, p));
    if (hit && now - hit.at < PROBE_TTL_MS) out.set(p, hit);
    else ask.push(p);
  }
  if (!ask.length) return out;
  const script = `for p in ${ask.map(shellQuote).join(" ")}; do printf '%s\\t%s\\n' "$(git -C "$p" config --get remote.origin.url 2>/dev/null)" "$(git -C "$p" rev-parse --abbrev-ref HEAD 2>/dev/null)"; done`;
  const { stdout } = await hostExec(hostId, script, 15000).catch(() => ({
    stdout: "",
  }));
  const lines = stdout.split("\n");
  ask.forEach((p, i) => {
    const [url = "", branch = ""] = (lines[i] ?? "").split("\t");
    const found = { url: url.trim(), branch: branch.trim() };
    probes.set(key(hostId, p), { at: now, ...found });
    out.set(p, found);
  });
  return out;
}

// The open PR a branch has in a repository, cached for a minute.
async function prOf(
  slug: string,
  branch: string
): Promise<ExternalSession["pr"]> {
  const k = `${slug}\t${branch}`;
  const hit = prs.get(k);
  if (hit && Date.now() - hit.at < PROBE_TTL_MS) return hit.pr;
  const out = await run(
    "gh",
    [
      "pr",
      "list",
      "--repo",
      slug,
      "--head",
      branch,
      "--state",
      "open",
      "--limit",
      "1",
      "--json",
      "number,url",
    ],
    os.tmpdir(),
    15000
  ).catch(() => null);
  if (out === null) return null;
  const first = (JSON.parse(out) as { number: number; url: string }[])[0];
  const pr = first ? { number: first.number, url: first.url, slug } : null;
  prs.set(k, { at: Date.now(), pr });
  return pr;
}

// A folder named after the repository: "workstak-app", "workstak-app--ws-1".
export function namedAfter(path: string, repoName: string): boolean {
  const name = repoName.toLowerCase();
  return path
    .toLowerCase()
    .split("/")
    .some(
      (seg) =>
        seg === name || seg.startsWith(`${name}-`) || seg.startsWith(`${name}_`)
    );
}

const last = new Map<string, { at: number; list: ExternalSession[] }>();

export async function externalSessions(
  workspaceId: string
): Promise<ExternalSession[]> {
  await statusDetector.refreshCache();
  const db = getDb();
  const ours = workspaceProjects(workspaceId);
  const ourIds = new Map(ours.map((p) => [p.id, p]));
  const repos = await workspaceRepos(workspaceId);
  const bySlug = new Map(repos.map((r) => [r.slug, r.project]));
  const found = discoverSessions(
    statusDetector.cachedSessions(),
    queries.getAllProjects(db).all() as Project[],
    queries.getAllSessions(db).all() as Session[]
  );
  const hosts = [...new Set(found.map((f) => f.hostId || "local"))];
  const probed = new Map<
    string,
    Map<string, { url: string; branch: string }>
  >();
  await Promise.all(
    hosts
      .filter((h) => !hostLink(h))
      .map(async (h) =>
        probed.set(
          h,
          await probe(
            h,
            found.filter((f) => (f.hostId || "local") === h).map((f) => f.path)
          )
        )
      )
  );
  const list: ExternalSession[] = [];
  for (const f of found) {
    // Its name reaches the orchestrator as a handle, not fenced text: one
    // tmux itself would refuse to be addressed by isn't listed.
    if (!isValidTmuxName(f.name)) continue;
    const hostId = f.hostId || "local";
    const git = probed.get(hostId)?.get(f.path);
    const slug = slugOfRemote(git?.url);
    let project: Project | undefined;
    let matched: ExternalSession["matched"] = "folder";
    if (f.projectId && ourIds.has(f.projectId))
      project = ourIds.get(f.projectId);
    else if (slug && bySlug.has(slug)) {
      project = bySlug.get(slug);
      matched = "repository";
    } else if (hostLink(hostId)) {
      const r = repos.find((r) => namedAfter(f.path, r.slug.split("/")[1]));
      if (r) {
        project = r.project;
        matched = "folder name";
      }
    }
    if (!project) continue;
    const branch = git?.branch && git.branch !== "HEAD" ? git.branch : null;
    const prSlug =
      slug ?? repos.find((r) => r.project.id === project!.id)?.slug;
    const host =
      hostId === "local" ? "this machine" : (getHost(hostId)?.name ?? hostId);
    list.push({
      hostId,
      host,
      name: f.name,
      ref: hostId === "local" ? f.name : `${f.name}@${host}`,
      path: f.path,
      project: project.name,
      matched,
      branch,
      pr: branch && prSlug ? await prOf(prSlug, branch) : null,
      lastActive: Math.max(f.activity, f.output),
      title: f.title ?? "",
    });
  }
  last.set(workspaceId, { at: Date.now(), list });
  return list;
}

// One of the workspace's external sessions by its name, or name@machine.
export async function findExternalSession(
  workspaceId: string,
  ref: string,
  opts: { fresh?: boolean } = {}
): Promise<ExternalSession | null> {
  const r = ref.trim().toLowerCase();
  const kept = last.get(workspaceId);
  const list =
    !opts.fresh && kept && Date.now() - kept.at < 5 * PROBE_TTL_MS
      ? kept.list
      : await externalSessions(workspaceId);
  const hits = list.filter(
    (s) => s.ref.toLowerCase() === r || s.name.toLowerCase() === r
  );
  if (hits.length > 1)
    throw new Error(
      `"${ref}" is an external session on ${hits.map((h) => h.host).join(" and ")}: use ${hits.map((h) => h.ref).join(" or ")}`
    );
  return hits[0] ?? null;
}

// The last listing's session by that name, without looking again: for
// refusing what can't be done to one.
export function knownExternalSession(
  workspaceId: string,
  ref: string
): ExternalSession | null {
  const r = ref.trim().toLowerCase();
  return (
    last
      .get(workspaceId)
      ?.list.find(
        (s) => s.ref.toLowerCase() === r || s.name.toLowerCase() === r
      ) ?? null
  );
}

function ago(seconds: number, now = Date.now()): string {
  if (!seconds) return "activity unknown";
  const m = Math.max(0, Math.round((now / 1000 - seconds) / 60));
  if (m < 1) return "active just now";
  if (m < 60) return `last active ${m}m ago`;
  const h = Math.round(m / 60);
  return h < 48
    ? `last active ${h}h ago`
    : `last active ${Math.round(h / 24)}d ago`;
}

// The sessions tool's lines for them, after AgentOS's own.
export function describeExternal(
  list: ExternalSession[],
  now = Date.now()
): string {
  if (!list.length) return "";
  const lines = list.map((s) => {
    const where = [
      s.project,
      s.matched === "folder name" ? "matched by folder name" : null,
      s.branch ? `branch ${untrusted(s.ref, s.branch)}` : null,
      s.pr ? `PR ${s.pr.slug}#${s.pr.number}` : s.branch ? "no open PR" : null,
    ]
      .filter(Boolean)
      .join(", ");
    const title = s.title ? `, ${untrusted(s.ref, s.title)}` : "";
    return `- ${s.ref} (${where}): ${ago(s.lastActive, now)}${title}`;
  });
  return [
    `${list.length} external ${list.length === 1 ? "session" : "sessions"} (not started by AgentOS; read only: read works, send/stop/done don't; sign_off and review take their PRs by number):`,
    ...lines,
  ].join("\n");
}

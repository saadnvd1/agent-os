/**
 * What a task's PR changes, read from git at its exact head commit, and the
 * plain rules a merge is held to before any model looks at it: nothing
 * outside the repository, no secrets, not only lockfiles, and nothing
 * touching CI, deploys or secrets handling without Saad.
 */

import path from "path";
import { run } from "../tasks/gh";
import { SECRET_ASSIGNMENT, SECRET_TOKENS } from "./untrusted";

export interface ChangedFile {
  path: string;
  status: string;
  // Where a symlink in the change points.
  link?: string;
}

// `git diff --raw` lines: ":old new oldsha newsha S\tpath".
export function parseRaw(raw: string): ChangedFile[] {
  return raw
    .split("\n")
    .filter((l) => l.startsWith(":"))
    .map((l) => {
      const [meta, file] = l.split("\t");
      const [, newMode, , , status] = meta.slice(1).split(" ");
      return {
        path: file,
        status,
        ...(newMode === "120000" ? { link: "" } : {}),
      };
    });
}

export async function changedFiles(
  repo: string,
  base: string,
  sha: string
): Promise<ChangedFile[]> {
  const raw = await run(
    "git",
    ["diff", "--raw", "--no-renames", `${base}...${sha}`],
    repo
  );
  const files = parseRaw(raw);
  for (const f of files)
    if (f.link !== undefined && f.status !== "D")
      f.link = (await run("git", ["show", `${sha}:${f.path}`], repo)).trim();
  return files;
}

// The lines the change adds, for the secrets check.
export async function addedLines(repo: string, base: string, sha: string) {
  const diff = await run(
    "git",
    ["diff", "-U0", "--no-color", `${base}...${sha}`],
    repo
  );
  return diff
    .split("\n")
    .filter((l) => l.startsWith("+") && !l.startsWith("+++"))
    .map((l) => l.slice(1))
    .join("\n");
}

const SENSITIVE: { why: string; test: RegExp }[] = [
  {
    why: "CI config",
    test: /^(\.github\/|\.gitlab-ci\.ya?ml$|\.circleci\/|\.buildkite\/|jenkinsfile|\.travis\.ya?ml$|azure-pipelines\.ya?ml$|bitbucket-pipelines\.ya?ml$)|(^|\/)codeowners$/i,
  },
  {
    why: "build and hook scripts",
    test: /(^|\/)(package\.json|\.npmrc|gemfile(\.lock)?|[^/]*\.gemspec|podfile|[^/]*\.podspec|app\.json|eas\.json|expo-module\.config\.json|react-native\.config\.[cm]?[jt]s|\.babelrc(\.[cm]?[jt]s|\.json)?|(metro|babel|app)\.config\.([cm]?[jt]s|json)|makefile|gnumakefile|\.gitmodules|lefthook(-local)?\.ya?ml|\.lefthook\/.*|\.pre-commit-config\.ya?ml)$|^(\.husky|\.githooks)\//i,
  },
  {
    why: "agent config",
    test: /^\.claude\/|(^|\/)(agentos\.json|\.agent-os\.json|\.dispatch\.json|\.mcp\.json)$|^\.agent-os\//i,
  },
  {
    why: "deploy",
    test: /(^|\/)((auto|re)?deploy|release|publish)([-_.][^/]*)?$|(^|\/)(deploy|k8s|helm|charts|terraform|infra)\/|\.tf$|(^|\/)(dockerfile|docker-compose[^/]*\.ya?ml|fly\.toml|vercel\.json|netlify\.toml|procfile)$/i,
  },
  {
    // What merges check a PR's code review with: a change that weakens it
    // must not merge through it.
    why: "the code review gate",
    test: /^(lib\/tasks\/code-review\.ts|scripts\/check-code-review\.ts)$/i,
  },
  {
    why: "secrets handling",
    test: /(^|\/)\.env(\.[^/]*)?$|(^|\/)[^/]*(secret|credential|tokenvault|keychain)[^/]*$|\.(pem|key|p12|pfx)$|(^|\/)(id_rsa|id_ed25519|\.npmrc|\.netrc)$|(^|\/)\.ssh\/|^lib\/security\/|^app\/api\/pair\//i,
  },
];

// Files a merge must go to Saad for, whatever the gates say.
export function sensitiveFiles(
  files: ChangedFile[]
): { path: string; why: string }[] {
  return files.flatMap((f) => {
    const hit = SENSITIVE.find((s) => s.test.test(f.path));
    return hit ? [{ path: f.path, why: hit.why }] : [];
  });
}

const LOCKFILES = new Set([
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "bun.lockb",
  "bun.lock",
  "Gemfile.lock",
  "Cargo.lock",
  "poetry.lock",
  "uv.lock",
  "composer.lock",
  "go.sum",
  "Podfile.lock",
  "Package.resolved",
]);

const escapes = (p: string) =>
  path.isAbsolute(p) || path.normalize(p).split(path.sep)[0] === "..";

// Why the change is outside its task's scope by rule, or [] when it isn't.
export function ruleBreaks(files: ChangedFile[], added: string): string[] {
  const out: string[] = [];
  if (!files.length) out.push("the PR changes no files");
  else if (files.every((f) => LOCKFILES.has(path.basename(f.path))))
    out.push("it changes only lockfiles");
  for (const f of files) {
    if (escapes(f.path)) out.push(`${f.path} is outside the repository`);
    else if (f.link && escapes(path.join(path.dirname(f.path), f.link)))
      out.push(`${f.path} links outside the repository (to ${f.link})`);
  }
  const secrets = secretsIn(added);
  if (secrets) out.push(`it adds what looks like a secret (${secrets})`);
  return out;
}

const PLACEHOLDER =
  /^(\$\{?|process\.env|os\.environ|ENV\[|<|your[-_]|changeme|example|dummy|x{4,}|\*+$)/i;

// A literal that reads like a credential: long, unbroken, letters and digits.
function looksLikeSecret(value: string): boolean {
  const v = value
    .trim()
    .replace(/[,;]$/, "")
    .replace(/^["'`]|["'`]$/g, "");
  return (
    v.length >= 12 &&
    !/\s/.test(v) &&
    /[A-Za-z]/.test(v) &&
    /\d/.test(v) &&
    !PLACEHOLDER.test(v)
  );
}

// The first credential-shaped thing in added text, described, or null.
export function secretsIn(text: string): string | null {
  for (const p of SECRET_TOKENS) {
    const m = text.match(new RegExp(p.source));
    if (m) return `${m[0].slice(0, 6)}…`;
  }
  if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(text)) return "a private key";
  for (const m of text.matchAll(new RegExp(SECRET_ASSIGNMENT.source, "gm"))) {
    const value = m[0].slice(m[1].length);
    if (looksLikeSecret(value))
      return `${m[1].trim().replace(/[=:]$/, "")} = …`;
  }
  return null;
}

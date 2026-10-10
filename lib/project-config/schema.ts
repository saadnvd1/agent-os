/**
 * What `agentos.json` may say, as code. agentos.schema.json is generated
 * from this (a test keeps the two identical) and the field-by-field design
 * is docs/decisions/2026-10-10-agentos-json.md.
 */

import { z } from "zod";

export const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const envName = z.string().regex(ENV_NAME, "must be a shell variable name");

// What a repository's `env` may not set: it reaches the agent, its chat and
// its terminals, so a name a shell, a runtime, git, an agent CLI or AgentOS
// reads would be a way to run code or redirect credentials.
export const RESERVED_ENV =
  /^(PATH|HOME|USER|LOGNAME|SHELL|SHELLOPTS|BASHOPTS|BASH_ENV|ENV|ZDOTDIR|PROMPT_COMMAND|PS[0-4]|IFS|TMPDIR|TERM|EDITOR|VISUAL|PAGER|BROWSER|NODE_OPTIONS|NODE_PATH|NODE_EXTRA_CA_CERTS|NODE_TLS_REJECT_UNAUTHORIZED|LD_\w*|DYLD_\w*|TMUX\w*|SSH_\w*|GIT_\w*|GH_\w*|GITHUB_\w*|ANTHROPIC_\w*|CLAUDE\w*|OPENAI_\w*|AGENTOS_\w*|AWS_\w*|PYTHON(PATH|STARTUP|HOME|SAFEPATH)|PERL5?(LIB|OPT)|RUBY(LIB|OPT)|BUNDLE_GEMFILE|JAVA_TOOL_OPTIONS|_JAVA_OPTIONS|NPM_CONFIG_\w*|HTTPS?_PROXY|ALL_PROXY|NO_PROXY|SSL_CERT_\w*|CURL_CA_BUNDLE|REQUESTS_CA_BUNDLE)$/i;
const projectEnvName = envName.refine(
  (name) => !RESERVED_ENV.test(name),
  "is reserved, because a shell, a runtime, git, the agent or AgentOS reads it, and env reaches the agent and its terminals"
);

// Relative, inside the project: no leading `/` or `~`, no `..` segment.
const projectPath = z
  .string()
  .regex(
    /^(?![/~\\])(?!(.*[/\\])?\.\.([/\\]|$)).+$/,
    "must be a path inside the project (relative, no '..')"
  );

const port = z.number().int().min(1024).max(65000);
const notes = z.union([z.string(), z.array(z.string())]);

const ready = z.strictObject({
  check: z.string().min(1).optional(),
  url: z.string().min(1).optional(),
  port: envName.optional(),
  contains: z.string().optional(),
});

const browse = z.strictObject({
  login: z.string().min(1).optional(),
  map: projectPath.optional(),
  port: envName.optional(),
});

const database = z.strictObject({
  from: z.string().min(1),
  env: projectEnvName.optional(),
  port: port.optional(),
  host: z.string().optional(),
});

// The fields later parts implement are described, and loose inside, so a
// `.dispatch.json` with extra keys of its own still reads.
const cards = z.looseObject({
  workspace: z.string().optional(),
  default: z.string().optional(),
  boards: z
    .record(
      z.string(),
      z.looseObject({
        board: z.string(),
        list: z.string(),
        name: z.string().optional(),
        prefix: z.string().optional(),
        triage: z.string().optional(),
      })
    )
    .optional(),
});

const alias = z.string().regex(/^[a-z0-9-]+$/, "must be [a-z0-9-]");

const shape = {
  $schema: z.string().optional(),
  ports: z.record(envName, port).optional(),
  env: z.record(projectEnvName, z.string()).optional(),
  setup: z.array(z.string().min(1)).optional(),
  copy: z.array(projectPath).optional(),
  clone: z.array(projectPath).optional(),
  dev: z.string().min(1).optional(),
  ready: ready.optional(),
  test: z.string().min(1).optional(),
  notes: notes.optional(),
  browse: browse.optional(),
  database: database.optional(),
  mcp: z.array(z.string().min(1)).optional(),
  model: z.string().min(1).optional(),
  alias: alias.optional(),
  cards: cards.optional(),
  auto: z
    .looseObject({
      min_free_gb: z.number().min(0).optional(),
      context: z.string().optional(),
    })
    .optional(),
  apps: z
    .record(
      alias,
      z.looseObject({
        path: projectPath,
        name: z.string().optional(),
        test: z.string().optional(),
        notes: notes.optional(),
      })
    )
    .optional(),
  recipes: z
    .record(
      alias,
      z.looseObject({
        prompt: z.string().min(1),
        title: z.string().optional(),
        description: z.string().optional(),
        model: z.string().optional(),
      })
    )
    .optional(),
  repos: z.array(z.string().min(1)).optional(),
  review_skill: z.string().min(1).optional(),
  notion: z
    .looseObject({
      vault: z
        .strictObject({ project: z.string(), token: z.string() })
        .optional(),
    })
    .optional(),
  formerly: z.array(z.string().min(1)).optional(),
};

// A port named by `ready` or `browse` that the project doesn't declare
// would be a URL to nowhere.
function portRefs(
  config: {
    ports?: Record<string, number>;
    ready?: { port?: string };
    browse?: { port?: string };
  },
  ctx: z.RefinementCtx
) {
  for (const key of ["ready", "browse"] as const) {
    const name = config[key]?.port;
    if (name && !(name in (config.ports ?? {})))
      ctx.addIssue({
        code: "custom",
        path: [key, "port"],
        message: `names ${name}, which is not in "ports"`,
      });
  }
}

// agentos.json: an unknown key is an error, because it is nearly always a
// typo that would otherwise be silently ignored.
export const agentosJson = z.strictObject(shape).superRefine(portRefs);

// .dispatch.json: the same fields, but dispatch has keys of its own. Its
// top-level `workspace` is `cards.workspace` here.
export const dispatchJson = z
  .object({ ...shape, workspace: z.string().optional() })
  .superRefine(portRefs);

export const legacyJson = z.object({
  setup: z.array(z.string()).optional(),
  devServer: z
    .object({ command: z.string().min(1), portEnvVar: envName.optional() })
    .optional(),
});

export type ProjectConfig = z.infer<typeof agentosJson>;

export function jsonSchema(): unknown {
  return {
    ...z.toJSONSchema(z.strictObject(shape), { io: "input" }),
    title: "agentos.json",
    description:
      "How AgentOS prepares a session's worktree and runs the project. See docs/decisions/2026-10-10-agentos-json.md.",
  };
}

/**
 * Model routing settings, kept in the settings table: the model each role
 * runs on, the providers (the presets, edited or added to), the price table,
 * and whether tasks plan first. A workspace may set its own role models.
 * Nothing here is ever a key: a provider names where its key lives.
 */

import { z } from "zod";
import { db } from "../db";
import { ENV_NAME, RESERVED_ENV } from "../project-config/schema";
import { KEY_ENV_NAME } from "./secrets";
import {
  DEFAULT_PRICES,
  PROVIDER_PRESETS,
  type ModelPrice,
  type ModelProvider,
} from "./providers";
import {
  ANTHROPIC,
  DEFAULT_ROLE_MODELS,
  MODEL_ROLES,
  REF_PATTERN,
  type ModelRole,
} from "./roles";
import {
  mustNotBeHaiku,
  SUBAGENT_PATTERN,
  SUBAGENT_TIERS,
  DEFAULT_SUBAGENT_MODELS,
  type SubagentModels,
} from "./subagent-tiers";

// A name passed to `tv` or `security` as its own argument: no option, no
// line break, nothing a shell would read.
const refName = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^[\w .@:+-]+$/, "letters, digits, spaces and . @ : + - _ only")
  .refine((s) => !s.startsWith("-"), "can't start with -");

const secretRef = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("tokenvault"),
    project: refName,
    desc: refName.optional(),
  }),
  z.strictObject({
    kind: z.literal("keychain"),
    service: refName,
    account: refName.optional(),
  }),
  z.strictObject({
    kind: z.literal("env"),
    name: z
      .string()
      .regex(
        KEY_ENV_NAME,
        "must be a *_API_KEY variable, not ANTHROPIC_, CLAUDE_ or AGENTOS_"
      ),
  }),
]);

const modelId = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^[\w.:@/-]+$/, "not a model id");

const baseUrl = z
  .string()
  .trim()
  .url()
  .refine(
    (u) =>
      u.startsWith("https://") ||
      /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/.test(u),
    "must be https (or http on localhost)"
  );

const providerSchema = z.strictObject({
  id: z
    .string()
    .regex(/^[a-z0-9][a-z0-9_-]{0,39}$/, "lowercase letters, digits, - and _"),
  label: z.string().trim().min(1).max(60),
  api: z.enum(["anthropic", "openai"]),
  baseUrl: baseUrl.optional(),
  auth: secretRef.optional(),
  authHeader: z.enum(["bearer", "x-api-key"]).optional(),
  models: z.array(modelId).max(40),
  tiers: z
    .strictObject({
      opus: modelId.optional(),
      sonnet: modelId.optional(),
      haiku: modelId.optional(),
    })
    .optional(),
  // A key can't hide here: no name an agent CLI reads for credentials.
  env: z
    .record(
      z
        .string()
        .regex(ENV_NAME)
        .refine((n) => !RESERVED_ENV.test(n), "is reserved"),
      z.string().max(200)
    )
    .optional(),
  contextWindow: z.number().int().min(100_000).max(10_000_000).optional(),
  enabled: z.boolean(),
});

const price = z.strictObject({
  input: z.number().min(0),
  cacheWrite: z.number().min(0),
  cacheRead: z.number().min(0),
  output: z.number().min(0),
});

const roleRef = z.string().trim().regex(REF_PATTERN, "must be provider/model");
const roleMap = z.partialRecord(z.enum(MODEL_ROLES), roleRef);

// Subagent type (or "prefix*") to the model its calls run on. A type that
// plans, decides or reviews can't be put on Haiku.
const subagentMap = z
  .record(
    z.string().regex(SUBAGENT_PATTERN, "not a subagent type"),
    z.enum(SUBAGENT_TIERS)
  )
  .refine((m) => Object.keys(m).length <= 40, "at most 40 entries")
  .superRefine((m, ctx) => {
    for (const [pattern, tier] of Object.entries(m))
      if (tier === "haiku" && mustNotBeHaiku(pattern))
        ctx.addIssue({
          code: "custom",
          message: `${pattern} plans, decides or reviews, so it can't run on Haiku`,
        });
  });

// A role may name a model to start on when its own can't be reached.
const fallbackMap = z.partialRecord(z.enum(MODEL_ROLES), roleRef);

export const modelSettingsSchema = z.strictObject({
  roles: roleMap.optional(),
  subagents: subagentMap.optional(),
  providers: z.array(providerSchema).optional(),
  prices: z.record(z.string().regex(REF_PATTERN), price).optional(),
  planStep: z.boolean().optional(),
  fallbacks: fallbackMap.optional(),
});

export const workspaceModelsSchema = z.strictObject({
  roles: roleMap.optional(),
});

export const projectModelsSchema = z.strictObject({
  roles: roleMap.optional(),
});

export type ModelSettings = z.infer<typeof modelSettingsSchema>;
export type WorkspaceModels = z.infer<typeof workspaceModelsSchema>;
export type ProjectModels = z.infer<typeof projectModelsSchema>;
export type RoleMap = Partial<Record<ModelRole, string>>;
export const roleMapSchema = roleMap;

const GLOBAL_KEY = "models";
const workspaceKey = (id: string) => `models.workspace.${id}`;
const projectKey = (id: string) => `models.project.${id}`;

function read<T>(key: string, schema: z.ZodType<T>): T | null {
  const row = db
    .prepare(`SELECT value FROM settings WHERE key = ?`)
    .get(key) as { value: string } | undefined;
  if (!row) return null;
  try {
    const got = schema.safeParse(JSON.parse(row.value));
    return got.success ? got.data : null;
  } catch {
    return null;
  }
}

function problems(error: z.ZodError): string {
  return error.issues
    .map((i) => `${i.path.join(".") || "(top level)"}: ${i.message}`)
    .join("; ");
}

function write<T>(key: string, schema: z.ZodType<T>, value: unknown): T {
  const got = schema.safeParse(value ?? {});
  if (!got.success)
    throw new Error(`Invalid model settings: ${problems(got.error)}`);
  db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(key, JSON.stringify(got.data));
  return got.data;
}

export const savedModelSettings = (): ModelSettings =>
  read(GLOBAL_KEY, modelSettingsSchema) ?? {};

export function setModelSettings(value: unknown): ModelSettings {
  const parsed = modelSettingsSchema.safeParse(value ?? {});
  if (!parsed.success)
    throw new Error(`Invalid model settings: ${problems(parsed.error)}`);
  const ids = parsed.data.providers?.map((p) => p.id) ?? [];
  if (new Set(ids).size !== ids.length)
    throw new Error("Invalid model settings: two providers share an id");
  const anthropic = parsed.data.providers?.find((p) => p.id === ANTHROPIC);
  if (anthropic && (anthropic.baseUrl || anthropic.auth || !anthropic.enabled))
    throw new Error(
      "Invalid model settings: anthropic is the Claude login; add another provider for an endpoint"
    );
  return write(GLOBAL_KEY, modelSettingsSchema, parsed.data);
}

export const workspaceModels = (workspaceId: string): WorkspaceModels =>
  read(workspaceKey(workspaceId), workspaceModelsSchema) ?? {};

export function setWorkspaceModels(
  workspaceId: string,
  value: unknown
): WorkspaceModels {
  const saved = write(workspaceKey(workspaceId), workspaceModelsSchema, value);
  if (!Object.keys(saved.roles ?? {}).length)
    db.prepare(`DELETE FROM settings WHERE key = ?`).run(
      workspaceKey(workspaceId)
    );
  return saved;
}

// Set in Settings, never in the repo, so work can't choose its own models.
export const projectModels = (projectId: string): ProjectModels =>
  read(projectKey(projectId), projectModelsSchema) ?? {};

export function setProjectModels(
  projectId: string,
  value: unknown
): ProjectModels {
  const saved = write(projectKey(projectId), projectModelsSchema, value);
  if (!Object.keys(saved.roles ?? {}).length) clearProjectModels(projectId);
  return saved;
}

export const clearProjectModels = (projectId: string): void => {
  db.prepare(`DELETE FROM settings WHERE key = ?`).run(projectKey(projectId));
};

// The settings in force: the presets with any saved edits laid over them
// (by id), saved providers that aren't presets, and every role filled.
export interface EffectiveModels {
  roles: Record<ModelRole, string>;
  subagents: SubagentModels;
  providers: ModelProvider[];
  prices: Record<string, ModelPrice>;
  planStep: boolean;
}

export function effectiveModels(
  saved: ModelSettings = savedModelSettings()
): EffectiveModels {
  const byId = new Map(PROVIDER_PRESETS.map((p) => [p.id, p]));
  for (const p of saved.providers ?? []) byId.set(p.id, p as ModelProvider);
  return {
    roles: { ...DEFAULT_ROLE_MODELS, ...saved.roles },
    subagents: { ...DEFAULT_SUBAGENT_MODELS, ...saved.subagents },
    providers: [...byId.values()],
    prices: { ...DEFAULT_PRICES, ...saved.prices },
    planStep: saved.planStep ?? true,
  };
}

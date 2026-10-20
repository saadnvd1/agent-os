import { z } from "zod";

export const CLAIMS_SYNC_MS = 60_000;
// A local session's claim, renewed every sync while the session lives.
export const CLAIM_TTL_MS = 10 * 60_000;
// An outside session's claim, renewed by its hook or `aos claim touch`.
export const OUTSIDE_TTL_MS = 30 * 60_000;
// The most life a peer can give a claim here.
export const REMOTE_TTL_CAP_MS = 15 * 60_000;
export const TOMBSTONE_MS = 15 * 60_000;
export const MAX_WIRE_CLAIMS = 500;
export const MAX_FILES = 300;
export const MAX_HOPS = 2;

export const CLAIM_SOURCES = ["session", "outside"] as const;
export type ClaimSource = (typeof CLAIM_SOURCES)[number];
export const asSource = (s: unknown): ClaimSource =>
  s === "outside" ? "outside" : "session";
export type Released = "done" | "merged" | "abandoned";

export interface Claim {
  id: string;
  origin: string;
  originName: string;
  viaMachine: string | null;
  hops: number;
  source: ClaimSource;
  sessionId: string | null;
  sessionName: string | null;
  repo: string;
  branch: string | null;
  base: string | null;
  goal: string;
  files: string[];
  filesMore: number;
  prUrl: string | null;
  startedAt: number;
  expiresAt: number;
  released: Released | null;
  updatedAt: number;
}

// A path in a diff: relative, inside the repo, short.
export const safePath = (p: string) =>
  p.length > 0 &&
  p.length <= 300 &&
  !p.startsWith("/") &&
  !/^[a-zA-Z]:[\\/]/.test(p) &&
  !p.includes("\0") &&
  !p.split(/[\\/]/).includes("..");

const text = (max: number) => z.string().max(max * 4);

export const claimWire = z.object({
  id: z.string().min(1).max(100),
  origin: z.string().min(1).max(100),
  origin_name: text(60),
  hops: z.number().int().min(0).max(10).default(0),
  source: z.string().max(20).default("session"),
  session_name: text(120).nullable().optional(),
  repo: z.string().min(3).max(300),
  branch: z.string().max(250).nullable().optional(),
  base: z.string().max(250).nullable().optional(),
  goal: text(120),
  files: z.array(z.string().max(300)).max(MAX_FILES),
  files_more: z.number().int().min(0).max(1_000_000).default(0),
  pr_url: z.string().max(300).nullable().optional(),
  ttl_s: z.number().min(0).max(86_400),
  age_s: z.number().min(0).max(31_536_000),
  released: z.enum(["done", "merged", "abandoned"]).nullable().optional(),
});
export type ClaimWire = z.infer<typeof claimWire>;

export const exchangeBody = z.object({
  machine: z.object({ id: z.string().min(1).max(100), name: text(60) }),
  claims: z.array(claimWire).max(MAX_WIRE_CLAIMS),
});
export type ExchangeBody = z.infer<typeof exchangeBody>;

export interface Overlap {
  a: Claim;
  b: Claim;
  kinds: ("branch" | "files" | "goal")[];
  shared: string[];
  strength: "strong" | "weak";
}

// What an outside session posts: its folder's remote URL, branch and the
// paths of its diff. Never file contents.
export const outsideBody = z.object({
  id: z
    .string()
    .regex(/^o-[0-9a-f-]{36}$/)
    .optional(),
  remote: z.string().min(3).max(500),
  branch: z.string().max(250).nullable().optional(),
  base: z.string().max(250).nullable().optional(),
  goal: text(120).optional(),
  name: text(120).optional(),
  files: z.array(z.string().max(300)).max(5000).default([]),
});
export type OutsideBody = z.infer<typeof outsideBody>;

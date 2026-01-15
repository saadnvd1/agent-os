import crypto from "crypto";

export interface AuthConfig {
  enabled: boolean;
  mode: "jwt" | "password" | "disabled";
  secret?: string;
  password?: string;
  sessionTtlDays: number;
}

export function getAuthConfig(): AuthConfig {
  const enabled = process.env.AGENTOS_AUTH_ENABLED === "true";
  const secret = process.env.AGENTOS_AUTH_SECRET;
  const password = process.env.AGENTOS_AUTH_PASSWORD;
  const sessionTtlDays = parseInt(process.env.AGENTOS_SESSION_TTL_DAYS || "7");

  if (!enabled) {
    return { enabled: false, mode: "disabled", sessionTtlDays };
  }

  if (secret) {
    return { enabled: true, mode: "jwt", secret, sessionTtlDays };
  }

  if (password) {
    return { enabled: true, mode: "password", password, sessionTtlDays };
  }

  return { enabled: false, mode: "disabled", sessionTtlDays };
}

export function generateSessionId(): string {
  return crypto.randomBytes(32).toString("hex");
}

export function hashPassword(password: string): string {
  return crypto.createHash("sha256").update(password).digest("hex");
}

export function verifyPassword(input: string, stored: string): boolean {
  const inputHash = hashPassword(input);
  return crypto.timingSafeEqual(Buffer.from(inputHash), Buffer.from(stored));
}

export { verifyJwt, type JwtPayload } from "./jwt";
export {
  createSession,
  getSession,
  deleteSession,
  cleanupExpiredSessions,
} from "./sessions";

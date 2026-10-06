import { X509Certificate } from "crypto";

export interface CertStatus {
  expiresAt: string;
  daysLeft: number;
  /** Set when it needs renewing, or can't be read. */
  warning?: string;
}

const RENEW_AT_DAYS = 30;

export function certStatus(pem: string, now = Date.now()): CertStatus {
  try {
    const expires = new Date(new X509Certificate(pem).validTo);
    const daysLeft = Math.floor((expires.getTime() - now) / 86_400_000);
    return {
      expiresAt: expires.toISOString(),
      daysLeft,
      warning:
        daysLeft <= RENEW_AT_DAYS
          ? `The Connect certificate expires in ${daysLeft} days. Run agent-os connect --renew.`
          : undefined,
    };
  } catch {
    return {
      expiresAt: "",
      daysLeft: 0,
      warning:
        "The Connect certificate can't be read. Run agent-os connect --renew.",
    };
  }
}

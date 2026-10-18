import { HEALTH_DEFAULTS, type HealthConfig } from "./config";
import type { HealthFacts, Trip } from "./types";

export const NOW = Date.parse("2026-10-14T18:00:00Z");
export const config = (over: Partial<HealthConfig> = {}): HealthConfig => ({
  ...HEALTH_DEFAULTS,
  ...over,
});

export const facts = (over: Partial<HealthFacts> = {}): HealthFacts => ({
  now: NOW,
  machines: [],
  queue: [],
  bg: [],
  armed: [],
  ci: [],
  boots: [],
  deploys: [],
  errors: { recent: 0, baselineMean: 0 },
  ...over,
});

export const trip = (over: Partial<Trip> = {}): Trip => ({
  check: "load-red",
  subject: "local",
  severity: "warn",
  line: "This machine load has been red for 11m.",
  detail: {},
  workspaceId: null,
  ...over,
});

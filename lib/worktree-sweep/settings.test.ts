import { describe, expect, it } from "vitest";
import { randomUUID } from "crypto";
import { createProject } from "@/lib/projects";
import {
  DEFAULT_SWEEP_DAYS,
  resolveSweepDays,
  setGlobalSweepDays,
  setProjectSweepDays,
} from "./settings";

const project = () =>
  createProject({
    name: `app-${randomUUID().slice(0, 8)}`,
    workingDirectory: "/tmp/app",
  });

describe("sweep days setting", () => {
  it("defaults to 7", () => {
    setGlobalSweepDays(null);
    expect(resolveSweepDays(project().id)).toEqual({
      days: DEFAULT_SWEEP_DAYS,
      from: "default",
    });
    expect(DEFAULT_SWEEP_DAYS).toBe(7);
  });

  it("a global number beats the default, a project's own beats the global", () => {
    const p = project();
    setGlobalSweepDays(14);
    expect(resolveSweepDays(p.id)).toEqual({ days: 14, from: "global" });
    setProjectSweepDays(p.id, 2);
    expect(resolveSweepDays(p.id)).toEqual({ days: 2, from: "project" });
    expect(resolveSweepDays(project().id).days).toBe(14);
    setProjectSweepDays(p.id, null);
    expect(resolveSweepDays(p.id).from).toBe("global");
    setGlobalSweepDays(null);
  });

  it("0 is a real value that turns it off, globally and per project", () => {
    const p = project();
    setGlobalSweepDays(0);
    expect(resolveSweepDays(p.id)).toEqual({ days: 0, from: "global" });
    setGlobalSweepDays(5);
    setProjectSweepDays(p.id, 0);
    expect(resolveSweepDays(p.id)).toEqual({ days: 0, from: "project" });
    setGlobalSweepDays(null);
  });

  it("refuses a negative, fractional or huge number", () => {
    for (const bad of [-1, 1.5, 366, Number.NaN])
      expect(() => setGlobalSweepDays(bad)).toThrow(/whole number/);
  });

  it("a session without a project gets the global number", () => {
    setGlobalSweepDays(9);
    expect(resolveSweepDays(null).days).toBe(9);
    setGlobalSweepDays(null);
  });
});

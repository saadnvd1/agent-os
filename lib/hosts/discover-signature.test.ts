import { randomUUID } from "crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getDb, queries } from "../db";
import { seedSession } from "../orchestrator/testing";
import { createProject } from "../projects";
import { statusDetector, type TmuxSessionInfo } from "../status-detector";
import {
  discoveredSignature,
  resetDiscoveredSignature,
} from "./discover-signature";

const tmux = (name: string, path = "/tmp/x"): TmuxSessionInfo =>
  ({ name, hostId: "local", activity: 0, path }) as TmuxSessionInfo;

// How many times the signature read session or project rows.
function countQueries() {
  const sessions = vi.spyOn(queries, "getManagedTmuxNames");
  const projects = vi.spyOn(queries, "getProjectFolders");
  return () => sessions.mock.calls.length + projects.mock.calls.length;
}

describe("discoveredSignature", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    resetDiscoveredSignature();
  });

  it("reads no session or project rows while nothing moved", () => {
    let listing: object = {};
    let sessions = [tmux("mine")];
    vi.spyOn(statusDetector, "listingStamp").mockImplementation(() => listing);
    vi.spyOn(statusDetector, "cachedSessions").mockImplementation(
      () => sessions
    );
    vi.spyOn(statusDetector, "hostErrors").mockReturnValue({});
    const reads = countQueries();

    const first = discoveredSignature();
    expect(JSON.parse(first)[0]).toEqual([["local", "mine", null, "/tmp/x"]]);
    const afterFirst = reads();
    expect(afterFirst).toBe(2);
    for (let i = 0; i < 5; i++) expect(discoveredSignature()).toBe(first);
    expect(reads()).toBe(afterFirst);

    // A new tmux listing is read again.
    sessions = [tmux("mine"), tmux("other")];
    listing = {};
    expect(JSON.parse(discoveredSignature())[0]).toHaveLength(2);
    expect(reads()).toBe(afterFirst + 2);
  });

  it("recomputes when a session or project is written", () => {
    const project = createProject({
      name: `p-${randomUUID().slice(0, 6)}`,
      workingDirectory: "/tmp/sig-proj",
    });
    const listing = {};
    vi.spyOn(statusDetector, "listingStamp").mockReturnValue(listing);
    vi.spyOn(statusDetector, "hostErrors").mockReturnValue({});
    const id = randomUUID();
    vi.spyOn(statusDetector, "cachedSessions").mockReturnValue([
      tmux(`claude-${id}`, "/tmp/sig-proj/a"),
    ]);

    // Not ours yet: discovered, in the project its folder sits in.
    expect(JSON.parse(discoveredSignature())[0]).toEqual([
      ["local", `claude-${id}`, project.id, "/tmp/sig-proj/a"],
    ]);
    // AgentOS starts a session with that tmux name: no longer discovered.
    getDb()
      .prepare(
        `INSERT INTO sessions (id, name, tmux_name, working_directory, project_id) VALUES (?, 's', ?, '/tmp', ?)`
      )
      .run(id, `claude-${id}`, project.id);
    expect(JSON.parse(discoveredSignature())[0]).toEqual([]);
    // An unrelated write moves the version; the answer is the same.
    seedSession({ projectId: project.id, name: "other" });
    expect(JSON.parse(discoveredSignature())[0]).toEqual([]);
  });
});

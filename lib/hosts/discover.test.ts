import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { discoverSessions, homeRelative } from "./discover";
import type { Project, Session } from "../db";
import type { TmuxSessionInfo } from "../status-detector";

const project = (id: string, dir: string, host_id = "local") =>
  ({ id, working_directory: dir, is_uncategorized: false, host_id }) as Project;
const tmux = (name: string, path: string, hostId = "local") =>
  ({
    name,
    path,
    hostId,
    activity: 0,
    attached: false,
    windows: 1,
  }) as TmuxSessionInfo;

describe("homeRelative", () => {
  it("maps macOS, Linux and root homes to ~", () => {
    assert.equal(homeRelative("/Users/saad/dev/app"), "~/dev/app");
    assert.equal(homeRelative("/home/saad/dev/app/"), "~/dev/app");
    assert.equal(homeRelative("/root"), "~");
    assert.equal(homeRelative("/srv/app"), "/srv/app");
  });
});

describe("discoverSessions", () => {
  const projects = [
    project("app", "~/dev/app", "box"),
    project("web", "/Users/me/dev/app/web"),
  ];

  it("nests sessions under the deepest project folder on the same machine", () => {
    const found = discoverSessions(
      [
        tmux("a", "/home/me/dev/app/src", "box"),
        tmux("b", "/Users/me/dev/app/web/x"),
        tmux("c", "/home/me/dev/application", "box"),
        tmux("d", "/Users/me/dev/app/src"),
      ],
      projects,
      []
    );
    const byName = Object.fromEntries(found.map((f) => [f.name, f.projectId]));
    assert.deepEqual(byName, { a: "app", b: "web", c: null, d: null });
  });

  it("skips sessions agent-os already manages", () => {
    const found = discoverSessions(
      [tmux("claude-1", "/Users/me/dev/app/web")],
      projects,
      [{ tmux_name: "claude-1" } as Session]
    );
    assert.equal(found.length, 0);
  });
});

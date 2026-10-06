import { describe, it, expect } from "vitest";
import {
  createHost,
  deleteHost,
  getHost,
  isValidSshTarget,
  listHosts,
  sshTargetFor,
} from "@/lib/hosts";
import { createProject } from "@/lib/projects";

describe("ssh targets", () => {
  it("accepts user@host and aliases, rejects option injection", () => {
    expect(isValidSshTarget("alice@box.ts.net")).toBe(true);
    expect(isValidSshTarget("devbox")).toBe(true);
    expect(isValidSshTarget("-oProxyCommand=x")).toBe(false);
    expect(isValidSshTarget("a b")).toBe(false);
    expect(isValidSshTarget("a;rm")).toBe(false);
  });
});

describe("host registry", () => {
  it("always lists this machine first and resolves local to no ssh", () => {
    expect(listHosts()[0].id).toBe("local");
    expect(sshTargetFor("local")).toBeNull();
    expect(sshTargetFor(undefined)).toBeNull();
  });

  it("creates and resolves a remote host", () => {
    const host = createHost("box", "me@box");
    expect(getHost(host.id)?.ssh_target).toBe("me@box");
    expect(sshTargetFor(host.id)).toBe("me@box");
  });

  it("will not delete a host a project still uses", () => {
    const host = createHost("busy", "me@busy");
    createProject({ name: "p", workingDirectory: "/tmp", hostId: host.id });
    expect(() => deleteHost(host.id)).toThrow(/Move or delete/);
  });

  it("cannot delete this machine", () => {
    expect(() => deleteHost("local")).toThrow();
  });
});

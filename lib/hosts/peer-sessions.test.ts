import { describe, expect, it } from "vitest";
import { toPeerSession, toTmuxInfo } from "./peer-sessions";

describe("what a linked machine says", () => {
  it("keeps its own sessions, checked and cleaned", () => {
    const s = toPeerSession("box", {
      id: "abc-1",
      name: "fix\u001b[31m it",
      tmux_name: "claude-abc-1",
      view: "chat",
      agent_type: "claude",
      working_directory: "/home/me/x",
      orch_token: "secret",
    });
    expect(s).toMatchObject({ id: "abc-1", name: "fix [31m it", view: "chat" });
    expect(JSON.stringify(s)).not.toContain("secret");
  });

  it("drops its mirrors of other machines and anything malformed", () => {
    expect(
      toPeerSession("box", { id: "a", host_id: "mac", tmux_name: "x" })
    ).toBeNull();
    expect(toPeerSession("box", { id: "../etc", tmux_name: "x" })).toBeNull();
    expect(toPeerSession("box", { id: "a", tmux_name: "bad name" })).toBeNull();
    expect(toTmuxInfo("box", { name: "a;b" })).toBeNull();
    expect(toTmuxInfo("box", { name: "ok", title: 7 })?.hostId).toBe("box");
  });
});

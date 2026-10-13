import fs from "fs";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import {
  agentSession,
  buildArgs,
  openArgs,
  screenshotPath,
  shotsDir,
  stateDir,
  toolEnv,
} from "./agent-device";

const target = {
  udid: "UDID-1",
  sessionId: "11111111-2222-3333-4444-555555555555",
  app: "com.example.app",
};
const tail = [
  "--platform",
  "ios",
  "--udid",
  "UDID-1",
  "--session",
  "aos-11111111",
];

describe("buildArgs", () => {
  it("always targets the task's own device and session", () => {
    expect(buildArgs(["snapshot", "-i"], target)).toEqual([
      "snapshot",
      "-i",
      ...tail,
    ]);
    expect(agentSession(target.sessionId)).toBe("aos-11111111");
  });

  it("passes quoted text through as one argument", () => {
    expect(buildArgs(["fill", "@e5", "hello world; rm -rf /"], target)).toEqual(
      ["fill", "@e5", "hello world; rm -rf /", ...tail]
    );
  });

  it("refuses commands off the list", () => {
    for (const sub of [
      "boot",
      "shutdown",
      "daemon",
      "device",
      "install",
      "open",
      "",
    ])
      expect(() => buildArgs([sub], target), sub).toThrow(/not allowed/);
    expect(() => buildArgs([], target)).toThrow(/not allowed/);
  });

  it("refuses flags that pick another device or session", () => {
    for (const flag of [
      "--udid",
      "--device",
      "--session",
      "--state-dir",
      "--ios-simulator-device-set",
    ]) {
      expect(() => buildArgs(["snapshot", flag, "x"], target), flag).toThrow(
        /set for you/
      );
      expect(() => buildArgs(["snapshot", `${flag}=x`], target), flag).toThrow(
        /set for you/
      );
    }
  });

  it("puts a screenshot under the session's shots dir unless given a path", () => {
    const argv = buildArgs(["screenshot"], target, () => 42);
    expect(screenshotPath(argv)).toBe(`${shotsDir(target.sessionId)}/42.png`);
    const own = buildArgs(
      ["screenshot", `${shotsDir(target.sessionId)}/x.png`],
      target
    );
    expect(screenshotPath(own)).toBe(`${shotsDir(target.sessionId)}/x.png`);
    expect(screenshotPath(buildArgs(["snapshot"], target))).toBeNull();
  });

  it("keeps a screenshot inside the shots dir or the worktree, as a png", () => {
    const wt = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), "aos-wt-"))
    );
    const t = { ...target, cwd: wt };
    const shot = (...a: string[]) =>
      screenshotPath(buildArgs(["screenshot", ...a], t));
    expect(shot("out.png")).toBe(path.join(wt, "out.png"));
    expect(shot("--out", "sub/x.png")).toBe(path.join(wt, "sub/x.png"));
    expect(shot("--out=x.png")).toBe(path.join(wt, "x.png"));
    expect(shot(`${shotsDir(target.sessionId)}/a.png`)).toBe(
      path.join(shotsDir(target.sessionId), "a.png")
    );
    expect(shot("--scale", "0.5")).toMatch(/shots\/\d+\.png$/);
    for (const bad of ["/etc/passwd.png", "../x.png", "x.txt", wt]) {
      expect(() => shot(bad), bad).toThrow(/\.png under this task's worktree/);
      expect(() => shot("--out", bad), bad).toThrow(/\.png/);
      expect(() => shot(`--out=${bad}`), bad).toThrow(/\.png/);
    }
    fs.symlinkSync(os.tmpdir(), path.join(wt, "link"));
    expect(() => shot("link/x.png")).toThrow(/\.png under/);
    fs.rmSync(wt, { recursive: true, force: true });
  });

  it("gives the tool a small environment, not the server's", () => {
    process.env.SECRET_TOKEN_FOR_TEST = "x";
    try {
      const env = toolEnv();
      expect(env.SECRET_TOKEN_FOR_TEST).toBeUndefined();
      expect(env.PATH).toBe(process.env.PATH);
      expect(env.AGENT_DEVICE_STATE_DIR).toBe(stateDir());
    } finally {
      delete process.env.SECRET_TOKEN_FOR_TEST;
    }
  });

  it("relaunches the project's app, and attaches the session at bring-up", () => {
    expect(buildArgs(["relaunch"], target).slice(0, 3)).toEqual([
      "open",
      "com.example.app",
      "--relaunch",
    ]);
    expect(openArgs(target)).toEqual(["open", "com.example.app", ...tail]);
  });
});

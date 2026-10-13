import { describe, expect, it } from "vitest";
import {
  agentSession,
  buildArgs,
  openArgs,
  screenshotPath,
  shotsDir,
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
    const own = buildArgs(["screenshot", "/tmp/x.png"], target);
    expect(screenshotPath(own)).toBe("/tmp/x.png");
    expect(screenshotPath(buildArgs(["snapshot"], target))).toBeNull();
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

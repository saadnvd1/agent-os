import os from "os";
import path from "path";
import { refuseRealStateUnderTest } from "./test-home-guard";

// Every path under ~/.agent-os is built here, so a test run that resolves one
// to the real home throws instead of leaving files in the owner's state.
export function agentosHome(...parts: string[]): string {
  return refuseRealStateUnderTest(
    path.join(os.homedir(), ".agent-os", ...parts)
  );
}

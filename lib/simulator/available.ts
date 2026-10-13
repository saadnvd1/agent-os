import fs from "fs";

// xcrun only exists on a Mac with Xcode.
export const simulatorAvailable = (): boolean =>
  process.platform === "darwin" && fs.existsSync("/usr/bin/xcrun");

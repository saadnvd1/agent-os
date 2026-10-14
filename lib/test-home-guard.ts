import os from "os";
import path from "path";

// Under the test runner, refuse a path inside the real ~/.agent-os: a test
// that resolves there would leave folders in the owner's state. The real
// home comes from the account, not $HOME, which the test setup replaces.
export function refuseRealStateUnderTest(p: string): string {
  if (!process.env.VITEST) return p;
  let real: string;
  try {
    real = os.userInfo().homedir;
  } catch {
    return p;
  }
  const state = path.join(real, ".agent-os");
  const resolved = path.resolve(p);
  if (resolved === state || resolved.startsWith(state + path.sep)) {
    throw new Error(
      `Refusing to use ${state} under the test runner (${resolved}): point HOME at a temp folder`
    );
  }
  return p;
}

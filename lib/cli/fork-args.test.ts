import { createRequire } from "module";
import { describe, expect, it, vi } from "vitest";

type Fork = Record<
  "fork" | "children" | "ret" | "cancel" | "wait",
  (words: string[]) => Promise<void>
>;
const make = createRequire(import.meta.url)("../../bin/aos-lib/fork.js") as (
  deps: Record<string, unknown>
) => Fork;

function setup() {
  const post = vi.fn(async (path: string) =>
    path === "/api/fork"
      ? { children: [{ n: 1, label: "x" }] }
      : { state: "settled", cancelled: [] }
  );
  const call = vi.fn(async () => ({ children: [] }));
  const needMe = vi.fn();
  const fail = (m: string): never => {
    throw new Error(m);
  };
  const lib = make({
    call,
    post,
    fail,
    needMe,
    me: "s1",
    stdin: async () => "",
  });
  return { lib, post, call, needMe };
}

describe("aos fork subcommand flags", () => {
  it("return --help prints usage and posts nothing", async () => {
    const { lib, post, needMe } = setup();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await lib.ret(["--help"]);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("aos return"));
    expect(post).not.toHaveBeenCalled();
    expect(needMe).not.toHaveBeenCalled();
    log.mockRestore();
  });

  it("fork --help and -h post nothing", async () => {
    const { lib, post } = setup();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await lib.fork(["--help"]);
    await lib.fork(["-h"]);
    expect(post).not.toHaveBeenCalled();
    log.mockRestore();
  });

  it("rejects an unknown bare flag", async () => {
    const { lib, post } = setup();
    await expect(lib.ret(["--bogus"])).rejects.toThrow(
      /unknown option --bogus/
    );
    await expect(lib.fork(["--wortree", "go"])).rejects.toThrow(
      /unknown option/
    );
    expect(post).not.toHaveBeenCalled();
  });

  it("still takes the known flags", async () => {
    const { lib, post } = setup();
    vi.spyOn(console, "log").mockImplementation(() => {});
    await lib.ret(["--failed", "couldn't"]);
    expect(post).toHaveBeenCalledWith("/api/fork/return", {
      from: "s1",
      text: "couldn't",
      failed: true,
    });
  });

  it("posts a multi-word result that starts with dashes as text", async () => {
    const { lib, post } = setup();
    vi.spyOn(console, "log").mockImplementation(() => {});
    await lib.ret(["--x means y"]);
    expect(post).toHaveBeenCalledWith("/api/fork/return", {
      from: "s1",
      text: "--x means y",
      failed: false,
    });
  });
});

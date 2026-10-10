import { describe, expect, it } from "vitest";
import { detectWsl, onWindowsDrive, wslNotes } from "./wsl";

describe("detectWsl", () => {
  it("reads the version from the kernel release", () => {
    expect(detectWsl("5.15.167.4-microsoft-standard-WSL2\n")).toBe(2);
    // WSL 2's kernels before 5.10 didn't say WSL2.
    expect(detectWsl("4.19.128-microsoft-standard")).toBe(2);
    expect(detectWsl("4.4.0-19041-Microsoft")).toBe(1);
  });

  it("isn't fooled by an ordinary Linux kernel", () => {
    expect(detectWsl("6.8.0-1017-azure")).toBe(0);
    expect(detectWsl(null)).toBe(0);
  });

  it("falls back to WSL_DISTRO_NAME when the kernel doesn't say", () => {
    expect(detectWsl(null, { WSL_DISTRO_NAME: "Ubuntu" })).toBe(2);
    expect(detectWsl("6.8.0-azure", { WSL_DISTRO_NAME: "Ubuntu" })).toBe(2);
    // The kernel wins when it names WSL 1.
    expect(detectWsl("4.4.0-19041-Microsoft", { WSL_DISTRO_NAME: "U" })).toBe(
      1
    );
  });
});

describe("onWindowsDrive", () => {
  it("matches a drive letter under /mnt", () => {
    expect(onWindowsDrive("/mnt/c")).toBe(true);
    expect(onWindowsDrive("/mnt/c/Users/me/code/app")).toBe(true);
    expect(onWindowsDrive("/mnt/D/work")).toBe(true);
  });

  it("leaves the Linux filesystem and other mounts alone", () => {
    expect(onWindowsDrive("/home/me/code/app")).toBe(false);
    expect(onWindowsDrive("/mnt/data/app")).toBe(false);
    expect(onWindowsDrive("/mnt/wsl/shared")).toBe(false);
    expect(onWindowsDrive("/srv/mnt/c/app")).toBe(false);
  });
});

describe("wslNotes", () => {
  it("says nothing off WSL", () => {
    expect(wslNotes(0, 3011, ["/mnt/c/app"])).toEqual([]);
  });

  it("points WSL 1 at WSL 2", () => {
    expect(wslNotes(1, 3011, [])).toEqual([
      expect.stringContaining("WSL 2 only"),
    ]);
  });

  it("gives the Windows URL, and names projects on the Windows drive", () => {
    const notes = wslNotes(2, 3011, ["/home/me/a", "/mnt/c/b"]);
    expect(notes[0]).toContain("http://localhost:3011");
    expect(notes).toHaveLength(2);
    expect(notes[1]).toContain("/mnt/c/b");
    expect(notes[1]).not.toContain("/home/me/a");
    expect(wslNotes(2, 3011, ["/home/me/a"])).toHaveLength(1);
  });
});

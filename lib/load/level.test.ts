import { describe, expect, it } from "vitest";
import { nextLevel, type LoadLevel } from "./level";
import {
  parseCpuPsi,
  parseDarwinPressure,
  parsePsiPressure,
  worse,
} from "./pressure";

const walk = (start: LoadLevel, perCore: number[]) =>
  perCore.reduce<LoadLevel[]>(
    (seen, x) => [...seen, nextLevel(seen.at(-1) ?? start, x, "normal")],
    []
  );

describe("load levels", () => {
  it("goes amber over 1.5 per core and red over 3", () => {
    expect(nextLevel("green", 1.4, "normal")).toBe("green");
    expect(nextLevel("green", 1.6, "normal")).toBe("amber");
    expect(nextLevel("green", 3.1, null)).toBe("red");
  });

  it("holds a level until the load is well below its line", () => {
    expect(walk("green", [3.2, 2.8, 2.6, 2.4, 1.3, 1.1])).toEqual([
      "red",
      "red",
      "red",
      "amber",
      "amber",
      "green",
    ]);
    // Hovering just under the amber line from green stays green.
    expect(walk("green", [1.4, 1.3, 1.45])).toEqual([
      "green",
      "green",
      "green",
    ]);
  });

  it("lets memory pressure raise the level whatever the load", () => {
    expect(nextLevel("green", 0.2, "warn")).toBe("amber");
    expect(nextLevel("green", 0.2, "critical")).toBe("red");
    expect(nextLevel("red", 0.2, "normal")).toBe("green");
  });
});

describe("memory pressure", () => {
  it("reads macOS's level", () => {
    expect(parseDarwinPressure("1\n")).toBe("normal");
    expect(parseDarwinPressure("2\n")).toBe("warn");
    expect(parseDarwinPressure("4\n")).toBe("critical");
    expect(parseDarwinPressure("")).toBeNull();
  });

  it("reads Linux PSI", () => {
    const psi = (some: number, full: number) =>
      `some avg10=${some} avg60=0.00 avg300=0.00 total=1\nfull avg10=${full} avg60=0.00 avg300=0.00 total=1\n`;
    expect(parsePsiPressure(psi(0.5, 0))).toBe("normal");
    expect(parsePsiPressure(psi(12, 1))).toBe("warn");
    expect(parsePsiPressure(psi(30, 6))).toBe("critical");
    expect(parsePsiPressure("nonsense")).toBeNull();
  });

  it("reads Linux CPU PSI and keeps the worse of the two", () => {
    expect(parseCpuPsi("some avg10=12.0 avg60=0 avg300=0 total=1\n")).toBe(
      "normal"
    );
    expect(parseCpuPsi("some avg10=65.0 avg60=0 avg300=0 total=1\n")).toBe(
      "warn"
    );
    expect(parseCpuPsi("some avg10=95.0 avg60=0 avg300=0 total=1\n")).toBe(
      "critical"
    );
    expect(worse("normal", "warn")).toBe("warn");
    expect(worse("critical", "warn")).toBe("critical");
    expect(worse(null, "normal")).toBe("normal");
  });
});

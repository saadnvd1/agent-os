import { afterEach, describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { tempDir } from "@/lib/test-temp";
import {
  findHardcodedPorts,
  hardcodedNote,
  literalPort,
} from "./findHardcodedPorts";

const dir = tempDir("aos-hardcoded-");
const write = (file: string, text: string) =>
  fs.writeFileSync(path.join(dir, file), text);
const scripts = (s: Record<string, string>) =>
  write("package.json", JSON.stringify({ scripts: s }));

afterEach(() => {
  for (const f of fs.readdirSync(dir)) fs.rmSync(path.join(dir, f));
});

describe("literalPort", () => {
  it("finds -p, --port, --port= and PORT=, and puts the session's port in", () => {
    expect(literalPort("next dev -p 3000", 3107)).toEqual({
      port: 3000,
      replaced: "next dev -p 3107",
    });
    expect(literalPort("vite --port 5173 --host", 3107)?.replaced).toBe(
      "vite --port 3107 --host"
    );
    expect(literalPort("astro dev --port=4321", 3107)?.replaced).toBe(
      "astro dev --port=3107"
    );
    expect(literalPort("PORT=3000 node server.js", 3107)?.replaced).toBe(
      "PORT=3107 node server.js"
    );
  });

  it("leaves a script that takes the port from the env alone", () => {
    expect(literalPort("next dev -p $PORT", 3107)).toBeNull();
    expect(literalPort("next dev", 3107)).toBeNull();
    expect(literalPort("node -p 'x'", 3107)).toBeNull();
  });
});

describe("findHardcodedPorts", () => {
  it("names the script and gives the command to run on the session's port", () => {
    scripts({ dev: "next dev -p 3000", build: "next build" });
    expect(findHardcodedPorts(dir, undefined, 3107)).toEqual([
      { where: "npm run dev", port: 3000, fix: "npx next dev -p 3107" },
    ]);
  });

  it("gives no command for a script with shell operators", () => {
    scripts({ dev: "npm run db && next dev -p 3000" });
    const [h] = findHardcodedPorts(dir, undefined, 3107);
    expect(h.fix).toBeNull();
    expect(hardcodedNote(h)).toBe(
      "`npm run dev` hardcodes port 3000: start it on your own port instead."
    );
  });

  it("finds a Vite config's server.port and an agentos.json dev", () => {
    scripts({ dev: "vite" });
    write(
      "vite.config.ts",
      "export default { server: { port: 3000, strictPort: true } }"
    );
    expect(findHardcodedPorts(dir, "bin/dev -p 3000", 3107)).toEqual([
      { where: "agentos.json dev", port: 3000, fix: "bin/dev -p 3107" },
      {
        where: "vite.config.ts",
        port: 3000,
        fix: "npx vite --port 3107 --strictPort",
      },
    ]);
  });

  it("is nothing for a project already on the session's port, or without a package.json", () => {
    expect(findHardcodedPorts(dir, undefined, 3107)).toEqual([]);
    scripts({ dev: "next dev -p 3107" });
    expect(findHardcodedPorts(dir, undefined, 3107)).toEqual([]);
  });
});

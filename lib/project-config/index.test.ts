import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  CONFIG_FILES,
  loadProjectConfig,
  portBases,
  projectEnv,
  readyCommand,
  withPorts,
} from "./index";
import { jsonSchema } from "./schema";
import { runningBrief } from "./brief";

const project = (files: Record<string, unknown>) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aos-config-"));
  for (const [name, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(
      path.join(dir, name),
      typeof body === "string" ? body : JSON.stringify(body)
    );
  }
  return dir;
};

describe("loadProjectConfig precedence", () => {
  const all = {
    "agentos.json": { dev: "from agentos" },
    ".dispatch.json": { dev: "from dispatch" },
    ".agent-os/worktrees.json": { devServer: { command: "from worktrees" } },
    ".agent-os.json": { devServer: { command: "from legacy" } },
  };

  it("reads the first file that exists, in order", () => {
    const expected = ["agentos", "dispatch", "worktrees", "legacy"];
    for (let i = 0; i < CONFIG_FILES.length; i++) {
      const files = Object.fromEntries(Object.entries(all).slice(i));
      const loaded = loadProjectConfig(project(files));
      expect(loaded.source).toBe(CONFIG_FILES[i]);
      expect(loaded.config.dev).toBe(`from ${expected[i]}`);
      expect(loaded.error).toBeNull();
    }
  });

  it("has nothing to say for a project without one", () => {
    expect(loadProjectConfig(project({}))).toEqual({
      config: {},
      source: null,
      error: null,
    });
  });

  it("refuses a broken agentos.json instead of falling through to an older file", () => {
    const dir = project({
      "agentos.json": { ports: { WEB: "3000" }, cloen: ["node_modules"] },
      ".agent-os.json": { setup: ["make"] },
    });
    const loaded = loadProjectConfig(dir);
    expect(loaded.source).toBe("agentos.json");
    expect(loaded.config).toEqual({});
    expect(loaded.error).toMatch(/^agentos\.json is invalid: /);
    expect(loaded.error).toContain("ports.WEB");
    expect(loaded.error).toContain("cloen");
  });

  it("refuses env names a shell, runtime, agent or AgentOS reads", () => {
    for (const name of [
      "NODE_OPTIONS",
      "BASH_ENV",
      "DYLD_INSERT_LIBRARIES",
      "ANTHROPIC_BASE_URL",
      "AGENTOS_TOKEN",
      "PATH",
      "HOME",
      "GIT_SSH_COMMAND",
    ]) {
      const loaded = loadProjectConfig(
        project({ "agentos.json": { env: { [name]: "x" } } })
      );
      expect(loaded.error, name).toContain(`env.${name}`);
    }
    // A .dispatch.json is held to the same rule.
    expect(
      loadProjectConfig(
        project({ ".dispatch.json": { env: { NODE_OPTIONS: "x" } } })
      ).error
    ).toContain("env.NODE_OPTIONS");
  });

  it("says when the JSON itself is broken", () => {
    const loaded = loadProjectConfig(project({ "agentos.json": "{ nope" }));
    expect(loaded.error).toMatch(/agentos\.json is not valid JSON/);
  });

  it("refuses a port that ready or browse names but ports doesn't declare", () => {
    const loaded = loadProjectConfig(
      project({
        "agentos.json": {
          ports: { WEB: 3000 },
          browse: { login: "/login", port: "API" },
        },
      })
    );
    expect(loaded.error).toContain(
      `browse.port: names API, which is not in "ports"`
    );
  });

  it("refuses copy and clone paths outside the project", () => {
    for (const bad of ["../x", "/etc/passwd", "~/.ssh", "a/../../b"]) {
      const loaded = loadProjectConfig(
        project({ "agentos.json": { copy: [bad] } })
      );
      expect(loaded.error, bad).toContain("copy.0");
    }
    expect(
      loadProjectConfig(
        project({ "agentos.json": { copy: ["config/master.key", ".env"] } })
      ).error
    ).toBeNull();
  });

  it("reads .dispatch.json with its own keys, and its workspace as cards.workspace", () => {
    const loaded = loadProjectConfig(
      project({
        ".dispatch.json": {
          workspace: "team",
          ports: { RAILS_PORT: 3000 },
          something_dispatch_only: true,
        },
      })
    );
    expect(loaded.error).toBeNull();
    expect(loaded.config.cards).toEqual({ workspace: "team" });
    expect(loaded.config).not.toHaveProperty("something_dispatch_only");
  });

  it("maps the legacy devServer to dev and a port", () => {
    const loaded = loadProjectConfig(
      project({
        ".agent-os.json": {
          setup: ["npm i"],
          devServer: { command: "npm run dev", portEnvVar: "WEB_PORT" },
        },
      })
    );
    expect(loaded.config).toEqual({
      setup: ["npm i"],
      dev: "npm run dev",
      ports: { WEB_PORT: 3100 },
    });
  });

  it("reads a changed file again", () => {
    const dir = project({ "agentos.json": { dev: "one" } });
    expect(loadProjectConfig(dir).config.dev).toBe("one");
    fs.writeFileSync(
      path.join(dir, "agentos.json"),
      JSON.stringify({ dev: "two!" })
    );
    expect(loadProjectConfig(dir).config.dev).toBe("two!");
  });
});

describe("agentos.schema.json", () => {
  it("is what the code validates", () => {
    const file = path.join(__dirname, "agentos.schema.json");
    const generated = jsonSchema();
    if (process.env.AGENTOS_WRITE_SCHEMA)
      fs.writeFileSync(file, JSON.stringify(generated, null, 2) + "\n");
    // Parsed, so prettier's formatting of the file doesn't matter.
    expect(
      JSON.parse(fs.readFileSync(file, "utf-8")),
      "regenerate: AGENTOS_WRITE_SCHEMA=1 npx vitest run lib/project-config"
    ).toEqual(generated);
  });

  it("validates the repository's own agentos.json", () => {
    const root = path.join(__dirname, "..", "..");
    const loaded = loadProjectConfig(root);
    expect(loaded.source).toBe("agentos.json");
    expect(loaded.error).toBeNull();
  });
});

describe("ports and env", () => {
  it("gives a project with no ports a PORT", () => {
    expect(portBases({})).toEqual({ PORT: 3100 });
    expect(portBases({ ports: { WEB: 3000 } })).toEqual({ WEB: 3000 });
  });

  it("drops reserved names however the config was read", () => {
    expect(projectEnv({ env: { NODE_OPTIONS: "x", MODE: "a" } }, null)).toEqual(
      {
        MODE: "a",
      }
    );
  });

  it("lets the session's ports win over the project's env", () => {
    expect(
      projectEnv({ env: { WEB: "1", MODE: "dev" } }, { WEB: 3001 })
    ).toEqual({ WEB: "3001", MODE: "dev" });
  });

  it("writes only port names into text", () => {
    expect(withPorts("http://localhost:$WEB/${WEB} $HOME", { WEB: 3001 })).toBe(
      "http://localhost:3001/3001 $HOME"
    );
  });

  it("turns ready into one command", () => {
    const ports = { WEB: 3001, API: 4001 };
    expect(
      readyCommand({ ready: { check: "pg_isready -p $API" } }, ports)
    ).toBe("pg_isready -p 4001");
    expect(readyCommand({ ready: { url: "/up" } }, ports)).toBe(
      "curl -sf 'http://localhost:3001/up' >/dev/null"
    );
    expect(
      readyCommand(
        { ready: { url: "/up", port: "API", contains: "ok" } },
        ports
      )
    ).toBe("curl -sf 'http://localhost:4001/up' | grep -q 'ok'");
    expect(readyCommand({ ready: { url: "/up" } }, {})).toBeNull();
  });
});

describe("runningBrief", () => {
  const config = {
    ports: { RAILS_PORT: 3000, VITE_PORT: 3100 },
    env: { SECRET_ISH: "do-not-render" },
    dev: "bin/dev",
    ready: { check: `curl -sf "http://localhost:$RAILS_PORT/up"` },
    test: "bundle exec rspec",
    browse: {
      login: "/__dev/login?as=dev",
      map: "docs/browsing.md",
      port: "RAILS_PORT",
    },
    notes: ["Kill by port: $RAILS_PORT", "Read CLAUDE.md first."],
  };
  const ports = { RAILS_PORT: 3004, VITE_PORT: 3104 };
  const brief = runningBrief(config, ports);

  it("says how to run and check the app on the session's own ports", () => {
    expect(brief).toMatch(/^## Running this project/);
    expect(brief).toContain("RAILS_PORT=3004, VITE_PORT=3104");
    expect(brief).toContain("Dev server: `bin/dev`");
    expect(brief).toContain(
      `until curl -sf "http://localhost:3004/up"; do sleep 1; done`
    );
    expect(brief).toContain("run_in_background");
    expect(brief).toContain("Tests: `bundle exec rspec`");
    expect(brief).toContain("http://localhost:3004/__dev/login?as=dev");
    expect(brief).toContain("`docs/browsing.md`");
    expect(brief).toContain("- Kill by port: 3004");
    expect(brief).toContain("- Read CLAUDE.md first.");
  });

  it("never renders env values", () => {
    expect(brief).not.toContain("do-not-render");
    expect(brief).not.toContain("SECRET_ISH");
  });

  it("says nothing the project didn't declare", () => {
    const bare = runningBrief({}, { PORT: 3101 });
    expect(bare).toContain("PORT=3101");
    expect(bare).not.toMatch(/Dev server|Tests|log in|exits 0/);
    expect(runningBrief({}, {})).toBe("");
  });

  it("stays short", () => {
    expect(brief.length).toBeLessThan(1200);
  });
});

import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// child_process and fs calls that block the event loop.
const SYNC_CALL =
  "/^(exec|execFile|spawn|access|appendFile|chmod|chown|copyFile|cp|exists|fstat|lstat|mkdir|mkdtemp|open|opendir|read|readdir|readFile|readlink|realpath|rename|rm|rmdir|stat|statfs|symlink|truncate|unlink|utimes|write|writeFile)Sync$/";
const SYNC_MESSAGE =
  "Blocks the event loop for every client: use the async form (fs/promises, promisified execFile, spawn) with a timeout.";

// git spawned anywhere but lib/git-exec.ts: each copy drifts in its timeout,
// environment (a prompt that hangs, the server's TMUX) and error shape.
const GIT_MESSAGE =
  "Run git through lib/git-exec (git(), gitResult(), gitOk() or a named operation): one timeout, environment and error type.";
const GIT_SPAWN = [
  {
    // execFile("git", …), spawn("git", …), run("git", …). An injected
    // runner (deps.runner) defaults to run(), which routes git to the helper.
    selector:
      'CallExpression[arguments.0.value="git"]:not([callee.property.name="runner"])',
    message: GIT_MESSAGE,
  },
  {
    // exec("git …") through a shell.
    selector:
      "CallExpression[callee.name=/^(exec|execSync|execAsync)$/][arguments.0.value=/^\\s*git\\s/]",
    message: GIT_MESSAGE,
  },
  {
    selector:
      "CallExpression[callee.name=/^(exec|execSync|execAsync)$/] > TemplateLiteral.arguments:first-child[quasis.0.value.raw=/^\\s*git\\s/]",
    message: GIT_MESSAGE,
  },
];
const SERVER_CODE = ["lib/**/*.ts", "app/**/*.ts", "server.ts", "mcp/**/*.ts"];
const NOT_GIT_HELPER = [
  "lib/git-exec.ts",
  "**/*.test.ts",
  "**/*.test-helpers.ts",
];

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // React Compiler rules flag patterns that need real refactors; tracked as warnings until then.
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/refs": "warn",
      "react-hooks/static-components": "warn",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
        },
      ],
    },
  },
  {
    // Browser code: crypto.randomUUID is undefined on a plain-http address.
    files: [
      "components/**",
      "hooks/**",
      "stores/**",
      "data/**",
      "app/**/*.tsx",
    ],
    rules: {
      "no-restricted-properties": [
        "error",
        {
          object: "crypto",
          property: "randomUUID",
          message: "Undefined over plain http; use uuid() from @/lib/uuid.",
        },
      ],
    },
  },
  {
    files: SERVER_CODE,
    ignores: NOT_GIT_HELPER,
    rules: { "no-restricted-syntax": ["error", ...GIT_SPAWN] },
  },
  {
    // A synchronous child process or file call in a route handler stalls the
    // whole server (every terminal, chat stream and request) until it ends.
    files: ["app/api/**/*.ts"],
    ignores: ["app/api/**/*.test.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: `ImportSpecifier[imported.name=${SYNC_CALL}]`,
          message: SYNC_MESSAGE,
        },
        {
          selector: `CallExpression > MemberExpression.callee[property.name=${SYNC_CALL}]`,
          message: SYNC_MESSAGE,
        },
        // This block's rule replaces the one above for app/api, so it
        // carries the git rule too.
        ...GIT_SPAWN,
      ],
    },
  },
  globalIgnores([
    ".next/**",
    ".next-build/**",
    ".next-prev/**",
    ".deps/**",
    "node_modules/**",
    "public/**",
    "next-env.d.ts",
    "dist/**",
  ]),
]);

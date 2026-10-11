import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// child_process and fs calls that block the event loop.
const SYNC_CALL =
  "/^(exec|execFile|spawn|access|appendFile|chmod|chown|copyFile|cp|exists|fstat|lstat|mkdir|mkdtemp|open|opendir|read|readdir|readFile|readlink|realpath|rename|rm|rmdir|stat|statfs|symlink|truncate|unlink|utimes|write|writeFile)Sync$/";
const SYNC_MESSAGE =
  "Blocks the event loop for every client: use the async form (fs/promises, promisified execFile, spawn) with a timeout.";

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
      ],
    },
  },
  globalIgnores([
    ".next/**",
    ".next-build/**",
    ".next-prev/**",
    "node_modules/**",
    "src-tauri/**",
    "public/**",
    "next-env.d.ts",
    "dist/**",
  ]),
]);

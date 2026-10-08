import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

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
    files: ["components/**", "hooks/**", "stores/**", "data/**", "app/**/*.tsx"],
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

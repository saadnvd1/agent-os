// Variables the server sets only for itself (`npm start`, `npm run dev`,
// the dev-instance spawner). A session that inherits them breaks the
// project it works in: NODE_ENV=production makes Vitest load React's
// production build, PORT makes a dev server bind the live one's port.
// AGENTOS_URL, AGENTOS_PORT and the session ids are not here: sessions need them.
export const SERVER_ONLY_ENV = [
  "NODE_ENV",
  "PORT",
  "AGENTOS_SERVER",
  "AGENTOS_DEV",
] as const;

// The server's environment as an agent or its tools should see it.
export function sessionBaseEnv(
  env: NodeJS.ProcessEnv = process.env
): NodeJS.ProcessEnv {
  const out = { ...env };
  for (const k of SERVER_ONLY_ENV) delete out[k];
  return out;
}

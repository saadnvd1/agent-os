/**
 * "Running this project": what the agent needs to run and check the app,
 * from the project's config and the session's own ports. Only what the
 * project declared is said; a guess about how to run it would be acted on.
 * It is in every turn's context, so it stays short.
 */

import {
  notesOf,
  portFor,
  readyCommand,
  withPorts,
  type ProjectConfig,
} from "./index";
import { databaseBrief, type SessionDatabase } from "./database";

export function runningBrief(
  config: ProjectConfig,
  ports: Record<string, number>,
  database: SessionDatabase | null = null
): string {
  const lines: string[] = [];
  const names = Object.entries(ports);
  if (names.length)
    lines.push(
      `- Your ports, exported in your shell and no other session's: ${names.map(([n, p]) => `${n}=${p}`).join(", ")}. Start servers on these; never stop a process you didn't start (kill by your port: \`lsof -ti tcp:<port> -sTCP:LISTEN | xargs kill\`).`
    );
  if (config.dev)
    lines.push(`- Dev server: \`${withPorts(config.dev, ports)}\``);
  const ready = readyCommand(config, ports);
  if (ready)
    lines.push(
      `- It's up when this exits 0: \`${ready}\`. Wait with ONE Bash call with run_in_background: \`until ${ready}; do sleep 1; done\`, and keep working until it notifies you. Don't poll by hand or sleep in the foreground.`
    );
  const db = databaseBrief(config.database, database);
  if (db) lines.push(db);
  if (config.test) lines.push(`- Tests: \`${withPorts(config.test, ports)}\``);
  const browse = config.browse;
  const port = portFor(browse?.port, ports);
  if (browse?.login && (port || /^https?:\/\//.test(browse.login))) {
    const url = /^https?:\/\//.test(browse.login)
      ? browse.login
      : `http://localhost:${port}${browse.login}`;
    lines.push(
      `- In the browser, log in with one navigation to ${withPorts(url, ports)}; don't look for a login form or credentials.`
    );
  }
  if (browse?.map)
    lines.push(
      `- \`${browse.map}\` maps every page to its URL: navigate by URL, don't explore.`
    );
  for (const note of notesOf(config.notes))
    lines.push(`- ${withPorts(note, ports)}`);
  return lines.length ? `## Running this project\n\n${lines.join("\n")}` : "";
}

/* eslint-disable @typescript-eslint/no-require-imports -- a CommonJS CLI helper */
// `aos claim install-hook [--user]`: merges the claim hook into the repo's
// .claude/settings.local.json, or the user's ~/.claude/settings.json. It
// shows the entries before writing; nothing is installed silently.
const fs = require("fs");
const os = require("os");
const path = require("path");

const EVENTS = ["SessionStart", "UserPromptSubmit", "Stop"];

module.exports = function installHook({ fail, git }) {
  return (args) => {
    const script = path.resolve(
      path.dirname(fs.realpathSync(__filename)),
      "../../scripts/claim-hook.sh"
    );
    if (!fs.existsSync(script)) fail(`hook script not found at ${script}`);
    const file = args.includes("--user")
      ? path.join(os.homedir(), ".claude", "settings.json")
      : path.join(
          git(["rev-parse", "--show-toplevel"]),
          ".claude",
          "settings.local.json"
        );
    let settings = {};
    try {
      settings = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch (err) {
      if (err.code !== "ENOENT") fail(`${file} isn't valid JSON; fix it first`);
    }
    settings.hooks = settings.hooks || {};
    const added = [];
    for (const ev of EVENTS) {
      const command = `"${script}" ${ev}`;
      const list = (settings.hooks[ev] = settings.hooks[ev] || []);
      const have = list.some((g) =>
        (g.hooks || []).some((h) =>
          String(h.command || "").includes("claim-hook.sh")
        )
      );
      if (have) continue;
      list.push({ hooks: [{ type: "command", command, timeout: 5 }] });
      added.push(`${ev}: ${command}`);
    }
    if (!added.length) return console.log(`already installed in ${file}`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(settings, null, 2) + "\n");
    console.log(`added to ${file}:\n  ${added.join("\n  ")}`);
  };
};

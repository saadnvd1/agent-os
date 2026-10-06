// Native modules are compiled for one Node ABI. After a Node upgrade they fail
// at the first database call, so check before starting and rebuild if needed.
import { createRequire } from "module";
import { execSync } from "child_process";

const require = createRequire(import.meta.url);
const modules = ["better-sqlite3", "node-pty"];

function loads(name) {
  try {
    if (name === "better-sqlite3") require(name)(":memory:").close();
    else require(name);
    return true;
  } catch (err) {
    return !String(err?.message).includes("NODE_MODULE_VERSION");
  }
}

const stale = modules.filter((m) => !loads(m));
if (stale.length) {
  console.log(`Rebuilding ${stale.join(", ")} for Node ${process.version}...`);
  execSync(`npm rebuild ${stale.join(" ")}`, { stdio: "inherit" });
}

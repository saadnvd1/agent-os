import fs from "fs";
import { startDevServer } from "@/lib/dev-instance";

const i = process.argv.indexOf("--port");
const requested = i === -1 ? undefined : Number(process.argv[i + 1]);

startDevServer({ worktree: fs.realpathSync(process.cwd()), requested })
  .then((r) =>
    console.log(
      `Dev server ${r.reused ? "already running" : "started"}: pid ${r.pid} on http://localhost:${r.port} (log ${r.log}). Stop it with npm run dev:stop.`
    )
  )
  .catch((e: Error) => {
    console.error(e.message);
    process.exit(1);
  });

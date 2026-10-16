import fs from "fs";
import { stopDevServer } from "@/lib/dev-instance";

stopDevServer(fs.realpathSync(process.cwd())).then((r) => {
  console.log(r.message);
  process.exit(r.ok ? 0 : 1);
});

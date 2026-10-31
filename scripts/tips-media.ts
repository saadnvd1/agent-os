// The media half of Tip of the Day.
//   tips-media.ts manifest             JSON of the tips that still need a picture or clip
//   tips-media.ts apply <handback.json> [--from DIR]
// apply copies the files (default: the handback's folder) into public/tips and
// fills each tip's `media` in content/tips.json; handback.json is { id: media }.
import fs from "fs";
import path from "path";
import { loadTips } from "@/lib/tips/load";
import { applyHandback, manifest } from "@/lib/tips/media";
import type { Media } from "@/lib/tips/schema";

const root = process.cwd();
const [cmd, file, ...rest] = process.argv.slice(2);

if (cmd === "manifest") {
  console.log(JSON.stringify(manifest(loadTips(root)), null, 2));
} else if (cmd === "apply" && file) {
  const from =
    rest[0] === "--from" ? rest[1] : path.dirname(path.resolve(file));
  const handback = JSON.parse(fs.readFileSync(file, "utf-8")) as Record<
    string,
    Media
  >;
  const ids = applyHandback(root, from, handback);
  console.log(`Applied media to ${ids.length} tips: ${ids.join(", ")}`);
} else {
  console.error(
    "Usage: tips-media.ts manifest | apply <handback.json> [--from DIR]"
  );
  process.exit(2);
}

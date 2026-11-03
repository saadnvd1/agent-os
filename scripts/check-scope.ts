// Prints, as JSON, what `scripts/check --changed` has to cover.
import { checkScope } from "@/lib/check-scope";

console.log(
  JSON.stringify(checkScope(process.cwd(), process.argv.includes("--full")))
);

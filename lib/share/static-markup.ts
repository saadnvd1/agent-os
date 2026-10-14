import { createRequire } from "module";
import path from "path";
import type { ReactElement } from "react";

// Next refuses a static import of react-dom/server in a route's module graph
// (it is meant for pages). A snapshot is a plain string, not a page, so it is
// loaded by name at run time; the bundler never sees the import.
const load = createRequire(path.join(process.cwd(), "package.json"));
let render: ((el: ReactElement) => string) | null = null;

export function renderToStaticMarkup(element: ReactElement): string {
  render ??= (
    load("react-dom/server") as { renderToStaticMarkup: typeof render & object }
  ).renderToStaticMarkup;
  return render!(element);
}

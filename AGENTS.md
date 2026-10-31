# Code rules

Every agent working in this repo follows these. Each rule has its reason.

## Code style

- TypeScript everywhere, never `any`. Why: types are the cheapest test we have.
- Absolute imports: `@/lib/x`, not `../lib/x`. Why: a file can move without its imports breaking.
- No unnecessary comments; comment only the why. No strong borders: use shadows and spacing.
- React Query for server state, `useState` for local state, Valtio for shared UI state, Context sparingly. Use `isPending` (not `isLoading`) and always show skeletons on the initial load.
- Purple theme (HSL hue 270).
- Mobile first: the primary device is a phone. Touch targets are at least 44x44px, single pane with bottom tabs, unified diffs.

## Structure

1. **Shared design-system components.** A UI element used in more than one place becomes a generic wrapper in `components/ui/` around the shadcn/Radix primitive (button, callout/notice, status badge, etc.), and call sites use the wrapper. Notices and status pills always use the shared component, never hand-built markup. Why: one place to change how it looks and behaves.
2. **API routes.** Validate request input with a zod schema. Routes stay thin orchestrators: business logic lives in `lib/`, and database access goes through the queries layer, not inline SQL in the route. This applies to new routes and any route you touch; don't bulk-migrate the existing ones. Why: input is checked once, at the edge, and logic can be tested without HTTP.
3. **Business logic as functional modules** in `lib/<domain>/<feature>/`: `index.ts` (public exports), `types.ts`, one file per action named as a verb (`startTask.ts`, `placeTask.ts`), and `utils.ts` if needed. Export plain functions, not classes with static methods; no React in `lib/`. Why: a feature is easy to find, import and test.
4. **Components.** Break large components into sub-components, with a folder per component once it has parts. Extract a hook only when it's used in more than one place. Why: small pieces stay readable, and a hook with one caller is indirection.
5. **File length.** A source file stays under ~900 lines. Past that, split it by responsibility. A file may exceed it only with a stated reason (a generated file, a single table of data). Why: files this size are where changes start colliding and review stops being possible.

## Standards

- Conventional commits; run the typecheck after each phase.
- Database migrations: one new file per migration in `lib/db/migrations/`, named `<YYYYMMDDTHHMM>_<snake_name>.ts` with a fresh UTC timestamp (see the README there). Never edit a migration that has shipped; keep each `up` safe to run twice.
- Tasks don't review their own work: the independent review of the PR's exact head commit at merge time is the one review. Fix the blocking findings it sends back.
- Never mention other products in code or docs.
- Dependencies install with pnpm, frozen to `pnpm-lock.yaml` (`scripts/install-deps`, or `pnpm install --frozen-lockfile`); never `npm install` or a plain `pnpm install` in AgentOS. Why: a plain install resolves ranges to versions newer than the reviewed lockfile. `pnpm-workspace.yaml` holds the 7-day `minimumReleaseAge` (an urgent security fix gets a dated `minimumReleaseAgeExclude` entry, never `0`) and `allowBuilds`, the only dependencies allowed to run install scripts (add one only after reading the script). See `docs/reference/dependencies.md`.
- **What's New line.** The last line of every PR body is `Whats-new: New|Improved|Fixed — <one plain sentence a user would understand>`, or `Whats-new: skip` when users won't see the change (refactors, tests, internals, security). It becomes the in-app What's New entry as written (`scripts/whats-new`, run by autodeploy), so: no jargon, no file or function names, no paths, hosts or other machine details, no other products. A merge with no line gets a sentence written from its commit subject alone. The review notes a missing line as advisory, never blocking. Why: the author knows the user-visible effect, and this costs no extra model call.

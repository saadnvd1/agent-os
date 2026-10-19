# Dependencies and installs

AgentOS installs its own npm dependencies with **pnpm**, frozen to
`pnpm-lock.yaml`, so nothing ever resolves a `^` range to a version newer than
the one reviewed in the lockfile. Three settings in `pnpm-workspace.yaml`
protect that, and one script is the only way AgentOS installs itself.

pnpm is pinned by `packageManager` in `package.json`. Node 22 bundles
corepack, which fetches that version (`corepack enable pnpm`; on Node 25+ run
`npm i -g corepack` first). `npm run <script>` keeps working for every script.

## Where installs happen

| Where                                                                    | What runs                                                                                                 |
| ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| First install, `agent-os install`, `agent-os update`, `scripts/setup.sh` | `scripts/install-deps`: `pnpm install --frozen-lockfile`, then the native check, then the PDF browser     |
| Autodeploy, the in-app Update, `scripts/redeploy`                        | the same install, **beside** the live `node_modules` (see below)                                          |
| CI (`.github/actions/setup`)                                             | `pnpm install --frozen-lockfile`, cached by the hash of the lockfile and settings                         |
| A new task or quick-change worktree                                      | the worktree's own lockfile decides: pnpm, npm, yarn or bun, frozen only (`lib/worktree-deps/install.ts`) |

A task worktree's install is frozen only, for every project: if the lockfile
and `package.json` disagree, setup fails and tells the agent, rather than a
plain install resolving ranges to versions the lockfile never pinned. Bun
1.3.9 doesn't apply `minimumReleaseAge` to `bun install --frozen-lockfile`, so
for a bun project the lockfile itself is the only guard.

## The 7-day cooldown

`minimumReleaseAge: 10080` (minutes) means pnpm will not install a version
published less than 7 days ago. A frozen install checks the lockfile against
it too, so a PR that brings in a fresh version fails CI at the install step,
naming each package and the cutoff.

**An urgent security fix** can't wait a week. Add the exact version to
`minimumReleaseAgeExclude` in `pnpm-workspace.yaml`, with the reason and date
in a comment, and say so in the PR:

```yaml
minimumReleaseAgeExclude:
  - some-package@1.2.3 # CVE-2026-0000, approved 2026-10-20
```

A transitive dependency of that package published inside the window needs its
own line. Remove the entries once the versions are a week old. Never set
`minimumReleaseAge: 0`.

## Install scripts

pnpm does not run a dependency's `preinstall`/`install`/`postinstall` unless
it is listed in `allowBuilds` in `pnpm-workspace.yaml`, and `strictDepBuilds`
fails the install when a package with such a script is not listed at all.

Today: `node-pty`, `better-sqlite3` and `esbuild` are on; `@swc/core`,
`unrs-resolver` and `fsevents` are off (their scripts only download a
fallback). **To add a package that needs its install script**, read the
script, add `package: true` with a comment saying why, and note it in the PR.
Changing the list changes the CI cache key, so CI reinstalls.

The project's own `postinstall` (making node-pty's `spawn-helper` executable)
and `prepare` (husky) are not dependency scripts and still run.

## Deploys never restart into a broken install

`scripts/redeploy` installs into `.deps/stage`, then runs
`scripts/check-native.mjs` against it: SQLite opens a database with
better-sqlite3 and a pty spawns with node-pty. Only if both work does the
tree replace `node_modules` (two renames; the old one stays in
`.deps/prev`). If the check fails, the deploy fails with the live
`node_modules`, build and server untouched, and autodeploy raises its usual
alert. A build that fails after the swap puts the old `node_modules` back;
`scripts/redeploy --rollback` restores the previous build and its
dependencies together. When the lockfile, settings and Node version are
unchanged the install is skipped.

## PDFs

Share → Download → PDF prints with Playwright's `chromium-headless-shell`, at
the revision the locked `playwright` package names. `scripts/install-deps` and
`scripts/redeploy` run `pnpm exec playwright install chromium-headless-shell`
(a no-op once present; a failed download only warns). On Linux the browser also
needs system libraries: if it warns about missing ones, run
`sudo pnpm exec playwright install-deps chromium-headless-shell`.
`lib/share/pdf.ts` looks for that shell first, then the full Chromium, then a
system Chrome.

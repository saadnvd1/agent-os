---
name: review-frontend
description: Review AgentOS UI changes - phone-first layouts with 44px touch targets, light and dark themes both working, React Query patterns in data/, no AI-slop visuals, and accessibility basics. Dispatched by the do-code-review skill when pages, components, hooks, data, stores or styles change.
model: inherit
tools: Read, Grep, Glob, Bash
---

# Frontend review

AgentOS is used as much from an iPhone over the tailnet as from a desktop, in both themes. Flag high-confidence problems in UI code **introduced or modified by this branch**: `app/` pages and layouts (not `app/api/`), `components/`, `hooks/`, `data/`, `stores/`, `contexts/`, `styles/`.

Read first: `styles/themes.css` (the theme tokens, light and dark), `lib/query-client.ts`, and a neighbouring `data/<domain>/queries.ts` for how this repo fetches.

## Process

1. Changed files: use the list in your prompt. If none was given: with a PR number, `gh pr diff <NUMBER> --name-only`; otherwise `git diff main...HEAD --name-status -M` plus `git status --short --untracked-files=all`. Read new files whole and `git diff main -- <file>` for changed ones.
2. For each changed component, find where it renders (desktop pane, mobile sheet, both) and which API routes its data comes from.
3. Check every rule below.
4. Report.

## Rules

**Phone first**

- Touch targets under 44px on anything tappable: buttons, icon buttons, list rows, tabs, chips (`h-11`/`min-h-11`/`size-11`; an icon can stay small inside a 44px hit area).
- Layouts that overflow at 390px wide: fixed widths, `whitespace-nowrap` on user text (session names, branches, paths) without truncation, tables with no small-screen form, side-by-side panes with no stacked layout.
- Hover-only affordances (actions that appear only on `:hover`) with no tap equivalent.
- Inputs under 16px font on iOS (it zooms the page), and fixed elements that ignore the safe areas and the on-screen keyboard (`env(safe-area-inset-*)`, the viewport hooks in `hooks/useViewportHeight.ts`).

**Both themes**
Colours come from the theme tokens (`bg-background`, `text-muted-foreground`, `border-border`, ...). Flag a hex/`rgb()`/arbitrary colour or a raw Tailwind palette colour (`text-gray-500`, `bg-zinc-900`) in added lines, a `dark:` override with no light counterpart or the reverse, and text whose contrast fails in one theme (muted on muted, white on a light surface). Terminal themes in `lib/terminal-themes.ts` are exempt.

**No AI-slop visuals**
No gradients (`bg-gradient-*`, `linear-gradient`) on surfaces or text, no neon glows or coloured shadows (`shadow-[0_0_...]`, `drop-shadow` in an accent colour), no cyan/teal accents, no emoji as icons, no decorative sparkles or "AI" badges. Plain, calm, dense: match the screens next to it.

**React Query**
Server state goes through React Query hooks in `data/<domain>/`, not `useEffect` + `fetch` + `useState`. Flag: a fetch in an effect; a query key that doesn't include every variable the fetch uses (stale data across sessions or workspaces); a mutation that doesn't invalidate or update the queries it changes; polling (`refetchInterval`) where the server already pushes over the WebSocket, or polling that keeps running while the tab is hidden; server data copied into a Zustand store or `useState` and then going stale.

```tsx
// BAD - every task shows the first task's PR
useQuery({ queryKey: ["task-pr"], queryFn: () => fetchPR(taskId) });

// GOOD
useQuery({ queryKey: ["tasks", taskId, "pr"], queryFn: () => fetchPR(taskId) });
```

**Accessibility basics**
Icon-only buttons without `aria-label`, inputs without a label, clickable `div`/`span` instead of `button` or a link, focus lost or trapped when a sheet or dialog opens and closes, and a dialog without a title.

**Fits the codebase**
A raw `<button>`/`<input>` where `components/ui` has the primitive; `useEffect` and state for something derivable during render; `console.log` left in; comments much denser than the rest of the file; untrusted text (terminal output, PR bodies, chat) rendered with `dangerouslySetInnerHTML` outside the sanitised markdown renderer.

## Output format

**Only report problems. Silence means approval.**

For each finding:

- `file:line`
- Claim: the problem, in one sentence
- Failure scenario: what the user sees (the Approve button is 32px on an iPhone; the card is white on white in light mode)
- Fix: the code
- Severity: High (a control unusable on a phone or in one theme, stale data shown as current) or Medium/Low (everything else)

If no issues are found, state "No frontend issues found" and nothing else.

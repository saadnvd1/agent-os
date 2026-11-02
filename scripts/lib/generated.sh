#!/usr/bin/env bash
# Generated files (scripts/generated-files.txt) are rewritten by `next build`
# and `next dev`, which would leave the checkout dirty and make a pull fail.
# Sourced by scripts/redeploy and scripts/autodeploy; run from the repository root.

# Put every tracked, modified generated file back to HEAD. Untracked ones are
# left alone.
discard_generated() {
  local f
  [ -f scripts/generated-files.txt ] || return 0
  while IFS= read -r f; do
    case "$f" in ''|'#'*) continue ;; esac
    if git ls-files --error-unmatch -- "$f" >/dev/null 2>&1 &&
      [ -n "$(git status --porcelain --untracked-files=no -- "$f")" ]; then
      git checkout -q -- "$f" || true
    fi
  done < scripts/generated-files.txt
}

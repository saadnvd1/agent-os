#!/bin/sh
# A Claude Code hook for sessions AgentOS didn't start. Usage:
#   claim-hook.sh <SessionStart|UserPromptSubmit|Stop>
# SessionStart prints other agents' overlapping work as hook context; the other
# events renew this folder's work claim (`aos claim touch`), at most every 60s
# and in the background. It sends repository paths, never file contents, and
# always exits 0 with nothing on stderr: a hook must never slow or break a prompt.

event="$1"
command -v aos >/dev/null 2>&1 || exit 0

limit() {
  if command -v timeout >/dev/null 2>&1; then timeout 4 "$@"; else "$@"; fi
}

case "$event" in
  SessionStart)
    out=$(limit aos claim check --hook 2>/dev/null </dev/null)
    case "$out" in '{'*) printf '%s\n' "$out" ;; esac
    ;;
  UserPromptSubmit | Stop)
    dir=$(git rev-parse --git-dir 2>/dev/null) || exit 0
    stamp="$dir/agentos-claim-stamp"
    now=$(date +%s)
    last=$(stat -c %Y "$stamp" 2>/dev/null || stat -f %m "$stamp" 2>/dev/null || echo 0)
    [ $((now - last)) -ge 60 ] || exit 0
    : >"$stamp" 2>/dev/null
    (limit aos claim touch --quiet >/dev/null 2>&1 </dev/null &) 2>/dev/null
    ;;
esac
exit 0

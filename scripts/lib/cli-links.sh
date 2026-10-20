#!/usr/bin/env bash
# The CLI links in ~/.local/bin and the checkout they must point into.
# AOS_BIN_DIR overrides the link folder (tests); AGENT_OS_HOME the state folder.

CLI_LINKS=("agent-os:scripts/agent-os" "aos:bin/aos")

# The checkout the live server runs from (cwd in live-server.json), else $1.
live_checkout() {
  local rec="${AGENT_OS_HOME:-$HOME/.agent-os}/live-server.json" cwd=""
  if [ -f "$rec" ]; then
    cwd=$(node -e 'try{const c=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).cwd;if(typeof c==="string")process.stdout.write(c)}catch{}' "$rec" 2>/dev/null || true)
  fi
  if [ -n "$cwd" ] && [ -d "$cwd" ]; then echo "$cwd"; else echo "${1:-}"; fi
}

# Repoint every CLI link that exists and points elsewhere, and log each one.
# With "create" as $2, a missing link is made too (install).
sync_cli_links() {
  local checkout="$1" create="${2:-}" dir="${AOS_BIN_DIR:-$HOME/.local/bin}"
  local pair name rel link want have
  [ -n "$checkout" ] || return 0
  for pair in "${CLI_LINKS[@]}"; do
    name="${pair%%:*}"; rel="${pair#*:}"
    link="$dir/$name"; want="$checkout/$rel"
    [ -e "$want" ] || continue
    if [ -L "$link" ]; then
      have=$(readlink "$link")
      [ "$have" = "$want" ] && continue
      ln -sfn "$want" "$link"
      echo "$(date '+%Y-%m-%d %-I:%M %p') CLI link $link repointed: $have -> $want"
    elif [ ! -e "$link" ] && [ "$create" = create ]; then
      mkdir -p "$dir"
      ln -sfn "$want" "$link"
    fi
  done
}

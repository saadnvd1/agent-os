#!/bin/sh
# A Claude Code hook that reports the session's state to its terminal as
# OSC 7501, the Program Status Protocol, which AgentOS reads from the pane.
# AgentOS copies it to ~/.agent-os/bin/agentos-status and passes it to the
# Claude sessions it starts (--settings). Usage: agentos-status <hook event>,
# the hook's JSON on stdin.
#
# It writes to the pane's tty, never to stdout (Claude reads that), and it
# always exits 0: a hook that fails must never slow down or break Claude.

event="$1"
input=$(cat 2>/dev/null)
[ -n "$TMUX_PANE" ] || exit 0

# The first "key": "value" string in the hook's one-line JSON.
field() {
  printf '%s' "$input" | awk -v k="\"$1\"" '{
    i = index($0, k); if (!i) exit
    s = substr($0, i + length(k))
    if (match(s, /^ *: *"[^"]*"/)) {
      v = substr(s, RSTART, RLENGTH); sub(/^ *: *"/, "", v); sub(/"$/, "", v)
      print v
    }
    exit
  }'
}

report() {
  tty=$(tmux display-message -p -t "$TMUX_PANE" '#{pane_tty}' 2>/dev/null)
  [ -n "$tty" ] && [ -w "$tty" ] || return 0
  printf '\033]7501;%s:app=claude-code\033\\' "$1" >"$tty" 2>/dev/null
}

blocked() {
  msg=$(printf '%s' "$2" | cut -c 1-200 | base64 | tr -d '\n')
  report "state=blocked:kind=$1${msg:+:msg=$msg}"
}

case "$event" in
  SessionStart) report "state=idle" ;;
  UserPromptSubmit | PostToolUse) report "state=working" ;;
  PreToolUse)
    case "$(field tool_name)" in
      AskUserQuestion) blocked question "Claude has a question" ;;
      ExitPlanMode) blocked permission "Approve the plan?" ;;
      *) report "state=working" ;;
    esac
    ;;
  PermissionRequest)
    tool=$(field tool_name)
    blocked permission "Allow ${tool:-a tool}?"
    ;;
  Notification)
    message=$(field message)
    # PermissionRequest already said which tool; older Claude Code versions
    # without it only send this notification.
    case "$(field notification_type)" in
      elicitation_dialog) blocked question "$message" ;;
      "")
        case "$message" in
          *permission*) blocked permission "$message" ;;
        esac
        ;;
    esac
    ;;
  Stop) report "state=done" ;;
  SessionEnd) report "state=clear" ;;
esac
exit 0

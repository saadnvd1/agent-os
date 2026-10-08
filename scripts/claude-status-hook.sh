#!/bin/sh
# A Claude Code hook that reports the session's state to its terminal as
# OSC 7501, the Program Status Protocol, which AgentOS reads from the pane.
# AgentOS copies it to ~/.agent-os/bin/agentos-status and passes it to the
# Claude sessions it starts (--settings). Usage: agentos-status <hook event>,
# the hook's JSON on stdin.
#
# It writes to the pane's tty, and to stdout (which Claude reads) only the
# heavy-command note below, as hook JSON. It always exits 0: a hook that fails must never slow down or break Claude.

event="$1"
input=$(cat 2>/dev/null)

# The first "key": "value" string in the hook's one-line JSON.
field() {
  printf '%s' "$input" | awk -v k="\"$1\"" '{
    i = index($0, k); if (!i) exit
    s = substr($0, i + length(k))
    if (match(s, /^ *: *"([^"\\]|\\.)*"/)) {
      v = substr(s, RSTART, RLENGTH); sub(/^ *: *"/, "", v); sub(/"$/, "", v)
      gsub(/\\"/, "\"", v)
      print v
    }
    exit
  }'
}

report() {
  [ -n "$TMUX_PANE" ] || return 0
  tty=$(tmux display-message -p -t "$TMUX_PANE" '#{pane_tty}' 2>/dev/null)
  [ -n "$tty" ] && [ -w "$tty" ] || return 0
  printf '\033]7501;%s:app=claude-code\033\\' "$1" >"$tty" 2>/dev/null
}

blocked() {
  # One line of at most 200 characters (bytes, for some awks: iconv then
  # drops a character that was cut in half). No control characters, or the
  # terminal refuses the whole report.
  msg=$(printf '%s' "$2" | tr -d '\000-\037\177' |
    awk '{ printf "%s", substr($0, 1, 200) }' |
    iconv -c -f UTF-8 -t UTF-8 2>/dev/null | base64 | tr -d '\n')
  report "state=blocked:kind=$1${msg:+:msg=$msg}"
}

# A question, a plan to approve, or a tool to allow.
asking() {
  tool=$(field tool_name)
  case "$tool" in
    AskUserQuestion)
      # The first question's text; JSON's \n and \t read as spaces.
      q=$(field question | sed 's/\\[nt]/ /g')
      blocked question "${q:-Claude has a question}"
      ;;
    ExitPlanMode) blocked permission "Approve the plan?" ;;
    *) blocked permission "Allow ${tool:-a tool}?" ;;
  esac
}

# A Bash call that may be a whole test suite, type check or build goes to
# AgentOS (lib/load), which answers with a note for Claude when other heavy
# commands are running or the load is red. Advisory: the command runs either
# way, at once. A slow or missing server means no note.
heavy() {
  [ "$(field tool_name)" = Bash ] || return 0
  # The command only: a description saying "build" isn't one.
  case "$(field command)" in
    *vitest* | *tsc* | *"next build"* | *eslint* | *xcodebuild* | *pytest* | \
      *jest* | *" test"* | *typecheck* | *lint* | *build*) ;;
    *) return 0 ;;
  esac
  where="${AGENTOS_URL:-http://127.0.0.1:3011}/api/load/hook?event=$1&session=$AGENTOS_SESSION_ID"
  # The token goes in through a config on fd 3, never argv (ps shows argv).
  auth=
  [ -z "$AGENTOS_TOKEN" ] ||
    auth="header = \"Authorization: Bearer $AGENTOS_TOKEN\""
  out=$(printf '%s' "$input" | curl -s --max-time 0.05 -K /dev/fd/3 \
    -H 'Content-Type: application/json' --data-binary @- "$where" 2>/dev/null 3<<EOF
$auth
EOF
)
  [ "$1" = PreToolUse ] || return 0
  case "$out" in '{"hookSpecificOutput"'*) printf '%s\n' "$out" ;; esac
}

# Commands that take down every session on the machine, the agent's own
# included. Inside tmux, $TMUX names the real server and wins over
# TMUX_TMPDIR, so `tmux kill-server` there kills it; only an explicit -S or -L
# targets a test server. Pattern kills match the live AgentOS server too.
refuse_server_kill() {
  cmd=$(field command)
  why=""
  case "$cmd" in
    *kill-server*)
      case "$cmd" in
        *" -S "* | *" -L "*) ;;
        *) why="tmux kill-server without -S or -L kills the real tmux server and every session on it (TMUX_TMPDIR is ignored inside tmux). Pass -S <socket> or -L <name>." ;;
      esac ;;
    *"pkill -f"* | *"pkill -9 -f"* | *"killall node"* | *"killall tmux"* | *"killall tsx"*)
      why="Pattern kills also match the live AgentOS server and its sessions. Kill by PID: kill \$(lsof -tiTCP:<port> -sTCP:LISTEN)." ;;
  esac
  [ -n "$why" ] || return 1
  printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"%s"}}\n' "$why"
}

# All of it is read before any of it runs: a file replaced mid-run can't
# leave a half-parsed script exiting 2, which Claude takes as "block".
main() {
case "$event" in
  SessionStart) report "state=idle" ;;
  UserPromptSubmit) report "state=working" ;;
  PostToolUse)
    report "state=working"
    heavy PostToolUse
    ;;
  PreToolUse)
    case "$(field tool_name)" in
      AskUserQuestion | ExitPlanMode) asking ;;
      Bash) refuse_server_kill || {
        report "state=working"
        heavy PreToolUse
      } ;;
      *)
        report "state=working"
        heavy PreToolUse
        ;;
    esac
    ;;
  # Claude asks permission for its own questions too: still a question.
  PermissionRequest) asking ;;
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
}
main
exit 0

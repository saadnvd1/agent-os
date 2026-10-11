import { hostExec } from "../hosts";
import { shellQuote } from "../hosts/ssh";
import { isValidTmuxName } from "../hosts/tmux-name";

// Run by sh on the machine the session lives on. The pane processes and
// everything under them are read before tmux ends the session (the kill only
// hangs up the panes' own shells), then asked to stop and, if any is still
// there a second later, killed. Only pids found under this session's panes
// are ever signalled.
export function endTmuxScript(name: string): string {
  return [
    `t=${shellQuote(`=${name}`)}`,
    `roots=$(tmux list-panes -s -t "$t" -F '#{pane_pid}' 2>/dev/null)`,
    `tree=$(ps -Ao pid=,ppid= | awk -v roots="$roots" 'BEGIN{n=split(roots,r,/[ \\n]+/);for(i=1;i<=n;i++)if(r[i]!="")s[r[i]]=1} {p[$1]=$2;a[NR]=$1} END{do{c=0;for(i=1;i<=NR;i++){k=a[i];if(!(k in s)&&(p[k] in s)){s[k]=1;c=1}}}while(c);for(k in s)print k}')`,
    `tmux kill-session -t "$t" 2>/dev/null`,
    `if [ -n "$tree" ]; then`,
    `  kill -TERM $tree 2>/dev/null`,
    `  alive=; for p in $tree; do kill -0 "$p" 2>/dev/null && alive="$alive $p"; done`,
    `  if [ -n "$alive" ]; then sleep 1; kill -KILL $alive 2>/dev/null; fi`,
    `fi`,
    `exit 0`,
  ].join("\n");
}

// Ends a tmux session and what its panes started, on the machine it runs on.
// A session that isn't there is nothing to do; this never throws.
export async function endTmuxSession(
  hostId: string | null | undefined,
  name: string | null | undefined
): Promise<void> {
  if (!name || !isValidTmuxName(name)) return;
  await hostExec(hostId, endTmuxScript(name), 15_000).catch(() => {});
}

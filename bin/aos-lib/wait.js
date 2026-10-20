// `aos send <session> [--await [--timeout 30m]] [--reply <id>] <message...>` and
// `aos wait <session> --until idle|merged|reply [--timeout 30m]`: a session
// that waits on another records it and ends its turn; AgentOS wakes it.
const UNTIL = ["idle", "merged", "reply"];

// The flags count only before the message starts, so a message may mention them.
function parseSendFlags(words, fail) {
  let awaiting = false;
  let timeout;
  let replyTo;
  let i = 0;
  for (; i < words.length; i++) {
    const w = words[i];
    if (w === "--await") awaiting = true;
    else if (w === "--timeout") {
      timeout = words[++i];
      if (!timeout) fail("--timeout needs a value like 30m");
    } else if (w === "--reply") {
      const n = words[++i];
      if (!/^\d+$/.test(n ?? "")) fail("--reply takes a message id");
      replyTo = Number(n);
    } else break;
  }
  if (timeout !== undefined && !awaiting) fail("--timeout goes with --await");
  return { awaiting, timeout, replyTo, rest: words.slice(i) };
}

const when = (deadline) =>
  `up to ${Math.max(1, Math.round((deadline - Date.now()) / 60000))}m`;

module.exports = function makeWait({ post, fail, needMe, me }) {
  async function wait(words) {
    needMe();
    let to;
    let until;
    let timeout;
    for (let i = 0; i < words.length; i++) {
      const w = words[i];
      if (w === "--until") until = words[++i];
      else if (w === "--timeout") timeout = words[++i];
      else if (!to) to = w;
      else
        fail(
          "usage: aos wait <session> --until idle|merged|reply [--timeout 30m]"
        );
    }
    if (!to || !UNTIL.includes(until))
      fail(
        "usage: aos wait <session> --until idle|merged|reply [--timeout 30m]"
      );
    if (words.includes("--timeout") && !timeout)
      fail("--timeout needs a value like 30m");
    const r = await post("/api/bus/wait", { from: me, to, until, timeout });
    if (r.already) {
      console.log(`not waiting: ${r.already}`);
      return;
    }
    const what = {
      idle: "to go idle",
      merged: "for its PR to merge",
      reply: "for a message from it",
    }[until];
    console.log(
      `waiting on ${r.target} ${what} (${when(r.deadline)}): end your turn and you'll be woken when it holds, or at the timeout`
    );
  }
  return { wait, parseSendFlags: (words) => parseSendFlags(words, fail), when };
};

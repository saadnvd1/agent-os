// What an ask says, made safe and classified on the server: the title is
// one plain line (so it can't forge an event line), titles that say the
// same thing fold into one subject, and a "decision" that is really money,
// outbound, irreversible or credentials gets that kind.

import type { AskKind } from "./asks";

export const cleanTitle = (title: string) =>
  title
    .replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, " ")
    .replace(/"/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);

const STOP = new Set(
  "a an the to of for on in at by with and or is are be it this that we i you should shall can could do does please ok okay".split(
    " "
  )
);

// The words of a title, without filler, in order: "Rotate the API key?"
// and "rotate API key" are one subject.
export function titleSubject(title: string): string {
  const words = title
    .toLowerCase()
    .replace(/[^a-z0-9$]+/g, " ")
    .split(" ")
    .filter((w) => w && !STOP.has(w));
  return `ask:${[...new Set(words)].sort().join(" ")}`;
}

const CLASSES: [AskKind, RegExp][] = [
  [
    "money",
    /\$\s?\d|\b(pay|paid|payment|purchase|buy|subscri\w*|invoice|charge|billing|refund|renew\w*|upgrade plan|pricing tier)\b/i,
  ],
  [
    "credentials",
    /\b(password|passkey|credential\w*|secret\w*|api key|token|2fa|ssh key|oauth|login)\b/i,
  ],
  [
    "irreversible",
    /\b(delete|deleting|drop table|truncate|wipe|destroy|force[- ]?push|irreversibl\w*|purge|rm -rf|migrate prod\w*)\b/i,
  ],
  [
    "public",
    /\b(post|publish\w*|tweet|announce\w*|email|e-mail|send (it|this|a message) to|press release|submit (the )?form|go live|launch)\b/i,
  ],
];

// The kind an ask gets: what was asked, unless a "decision" reads as a
// hard line.
export function classifyKind(
  kind: AskKind,
  title: string,
  detail: string
): AskKind {
  if (kind !== "decision") return kind;
  const text = `${title}\n${detail}`;
  return CLASSES.find(([, re]) => re.test(text))?.[0] ?? kind;
}

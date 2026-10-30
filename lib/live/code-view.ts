import type { LiveCodeView, LiveInvite } from "./types";
import { displayCode } from "./code";
import type { Runtime } from "./runtime";

const HINT =
  "Guests type this before they reach your lobby. You still let each one in.";

const RULES = "6 to 32 letters or digits.";

/** The access code block of a share, with the actions it offers right now. */
export function codeView(rt: Runtime, now = Date.now()): LiveCodeView {
  const code = rt.share.access_code;
  const locked = rt.codeLockedUntil && rt.codeLockedUntil > now;
  return {
    on: !!code,
    display: code ? displayCode(code) : null,
    copyText: code
      ? `${rt.share.url}\nAccess code: ${displayCode(code)}`
      : null,
    label: "Access code",
    hint: HINT,
    notice:
      code && locked
        ? `Too many wrong codes. New guests can join again at ${new Date(
            rt.codeLockedUntil!
          ).toLocaleTimeString([], {
            hour: "numeric",
            minute: "2-digit",
          })}, or change the code now.`
        : null,
    prompt: {
      title: "Use my own code",
      message: RULES,
      placeholder: "Your code",
    },
    actions: code
      ? [
          { kind: "copy", label: "Copy link and code" },
          { kind: "copy_link", label: "Copy link" },
          { kind: "new_code", label: "New code" },
          { kind: "set_code", label: "Use my own…" },
          { kind: "code_off", label: "Turn off" },
        ]
      : [{ kind: "code_on", label: "Turn on" }],
  };
}

export function inviteCode(): LiveInvite["code"] {
  return {
    default: false,
    label: "Require an access code",
    hint: HINT,
    customLabel: "Use my own code",
    rules: RULES,
  };
}

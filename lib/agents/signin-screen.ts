/**
 * The sign-in a CLI is waiting on, read from its screen: the link to open
 * and the one-time code to type there (a device flow), so a device can
 * finish it. Only the stretch of screen between the two lines a session
 * prints around its login is read, so the agent's own output (links and the
 * word "code" are everywhere in it) is never taken for a sign-in. What's
 * there is the CLI's own output, so nothing is trusted: a link is only
 * offered to open when its host is a sign-in page.
 */

// Printed by the session before the login and after it, whatever it did.
export const SIGN_IN_START = "AgentOS: signing in";
export const SIGN_IN_END = "AgentOS: sign-in finished";

export interface SignInScreen {
  url: string | null;
  code: string | null;
}

const CUE = /verif|authori[sz]|one.?time|confirm|enter|code|open/i;
const DONE = /logged in|signed in|success/i;
const URL_LINE = /https:\/\/\S+/;
const CODE_IN_URL = /user_code=([A-Z0-9-]{6,12})/;
const CODE_LINE = /\b([A-Z0-9]{4}-[A-Z0-9]{4})\b/;
const BARE_CODE = /^[A-Z0-9]{4}-[A-Z0-9]{4}$/;
const URL_PIECE = /^[\w\-./?=&%#:+~@]+$/;
// A URL cut by the pane's width: the piece before the cut ran this long.
const WRAPPED_AT = 30;
const LOOKBACK = 30;
const NEAR = 3;

// Where a device flow sends you: AWS's device-authorization page, the
// Builder ID and Identity Center portals, and Kiro's own login. Not every
// AWS host: S3 buckets and API gateways are anyone's.
const TRUSTED_HOSTS = [
  /^device\.sso\.[a-z0-9-]+\.amazonaws\.com$/,
  /^view\.awsapps\.com$/,
  /^d-[a-z0-9]+\.awsapps\.com$/,
  /^([a-z0-9-]+\.)?kiro\.dev$/,
];

export function trustedSignInUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return (
      u.protocol === "https:" &&
      !u.username &&
      !u.password &&
      TRUSTED_HOSTS.some((h) => h.test(u.hostname))
    );
  } catch {
    return false;
  }
}

// Lines of the screen, with a URL the pane cut across lines put back.
function joined(lines: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i].trim();
    const at = line.search(URL_LINE);
    if (at >= 0 && !/\s/.test(line.slice(at))) {
      let last = line.slice(at);
      for (;;) {
        const next = lines[i + 1]?.trim() ?? "";
        if (
          last.length < WRAPPED_AT ||
          !URL_PIECE.test(next) ||
          BARE_CODE.test(next)
        )
          break;
        line += next;
        last = next;
        i++;
      }
    }
    out.push(line);
  }
  return out;
}

export function findSignIn(text: string): SignInScreen | null {
  const all = text.split("\n");
  const start = all.findLastIndex((l) => l.includes(SIGN_IN_START));
  if (start < 0) return null;
  const during = all.slice(start + 1);
  if (during.some((l) => l.includes(SIGN_IN_END))) return null;
  const lines = joined(during.slice(-LOOKBACK));
  let found: { at: number; url: string } | null = null;
  lines.forEach((line, at) => {
    const url = line.match(URL_LINE)?.[0].replace(/[).,;]+$/, "");
    if (!url) return;
    const near = lines.slice(Math.max(0, at - NEAR), at + NEAR + 1);
    if (near.some((l) => CUE.test(l))) found = { at, url };
  });
  if (!found) return null;
  const { at, url } = found as { at: number; url: string };
  if (lines.slice(at + 1).some((l) => DONE.test(l))) return null;
  let code = url.match(CODE_IN_URL)?.[1] ?? null;
  if (!code)
    for (const l of lines.slice(Math.max(0, at - NEAR), at + NEAR + 1)) {
      const m = l.match(CODE_LINE);
      if (m && l !== url) {
        code = m[1];
        break;
      }
    }
  return { url, code };
}

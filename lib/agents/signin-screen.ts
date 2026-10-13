/**
 * The sign-in a CLI is waiting on, read from its screen: the link to open
 * and the one-time code to type there (a device flow), so a phone can finish
 * it. Only a screen from a CLI that signs in this way is read. What's on it
 * is the CLI's own output, so nothing here is trusted: a link is only
 * offered to open when its host is one of the sign-in pages.
 */

export interface SignInScreen {
  url: string | null;
  code: string | null;
}

const CUE = /sign.?in|log.?in|verif|device|authori[sz]|one.?time|code/i;
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

const TRUSTED_HOSTS = [
  /(^|\.)awsapps\.com$/,
  /(^|\.)amazonaws\.com$/,
  /(^|\.)aws\.amazon\.com$/,
  /(^|\.)kiro\.dev$/,
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
  const lines = joined(text.split("\n").slice(-LOOKBACK));
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

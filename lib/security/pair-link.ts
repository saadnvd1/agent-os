// Pure and import-free: the pair page bundles this for the browser, which
// pair-qr.ts (qrcode, reach) can't be.

// The code rides in the fragment, so it never reaches a server log.
export function pairPageLink(base: string, display: string): string {
  return `${base.replace(/\/+$/, "")}/pair#${display}`;
}

// Hands the pairing page's address to the native app. It claims nothing.
export function appPairLink(base: string, display: string): string {
  return `agentos://connect?url=${encodeURIComponent(pairPageLink(base, display))}`;
}

// iPadOS Safari sends a Mac user agent, so touch points tell it apart.
export function isPhoneOrTablet(ua: string, maxTouchPoints = 0): boolean {
  return (
    /iPhone|iPad|Android/.test(ua) ||
    (/Macintosh/.test(ua) && maxTouchPoints > 1)
  );
}

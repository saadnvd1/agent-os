/**
 * How an artifact page is served: as agent output, never as the app. The
 * CSP sandbox gives it an opaque origin, so scripts run but AgentOS cookies,
 * storage and API calls are out of reach, wherever the page is opened.
 */

// No allow-same-origin, ever; no popups, top navigation or modals.
export const ARTIFACT_SANDBOX = "allow-scripts allow-forms";

export const ARTIFACT_CSP = [
  `sandbox ${ARTIFACT_SANDBOX}`,
  "default-src 'none'",
  // Inline scripts and a chart library from a CDN.
  "script-src 'unsafe-inline' https:",
  "style-src 'unsafe-inline' https:",
  "img-src data: blob: https:",
  "font-src data: https:",
  "media-src data: blob: https:",
  "connect-src https:",
  "form-action 'none'",
  "base-uri 'none'",
  "frame-src 'none'",
  "object-src 'none'",
  "frame-ancestors 'self'",
].join("; ");

// Images may be SVG, which is a document when opened directly.
export const IMAGE_CSP =
  "default-src 'none'; style-src 'unsafe-inline'; sandbox";

export const ARTIFACT_HEADERS: Record<string, string> = {
  "Content-Type": "text/html; charset=utf-8",
  "Content-Security-Policy": ARTIFACT_CSP,
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Cache-Control": "private, max-age=3600",
};

// Added to every page: its default colours follow the reader's theme (the
// frame's color-scheme), and it tells the chat how tall it is so the frame
// fits. Only a number crosses, and the chat clamps it.
const ADDED = `<style>:where(:root){color-scheme:light dark}</style><script>(()=>{const r=()=>{const d=document.documentElement;parent.postMessage({agentosArtifactHeight:Math.ceil(Math.max(d.scrollHeight,document.body?document.body.scrollHeight:0))},"*")};addEventListener("load",r);new ResizeObserver(r).observe(document.documentElement);r()})()</script>`;

export function prepareArtifact(html: string): string {
  const at = html.search(/<\/body\s*>/i);
  return at === -1 ? html + ADDED : html.slice(0, at) + ADDED + html.slice(at);
}

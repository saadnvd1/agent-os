// Pure rules for the WebViews that show agent output (mermaid, artifacts):
// what a page may report back, what it may load, and its HTML.

// The height a page reports for itself, clamped; null for anything else.
// Same contract as the web's ArtifactFrame (`agentosArtifactHeight`).
export function reportedHeight(raw: string, max: number): number | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  const h = (data as { agentosArtifactHeight?: unknown } | null)
    ?.agentosArtifactHeight;
  if (typeof h !== "number" || !Number.isFinite(h)) return null;
  return Math.round(Math.min(Math.max(h, 80), max));
}

// A page may load itself (and frames/subresources it pulls in), but never
// navigate the WebView elsewhere on its own: a tap on a link opens Safari.
export type NavDecision = "load" | "external" | "block";
export function navigation(
  req: { url: string; navigationType?: string; isTopFrame?: boolean },
  home: string
): NavDecision {
  if (req.url === home || req.url === "about:blank" || req.isTopFrame === false)
    return "load";
  if (req.navigationType === "click" && /^https?:\/\//i.test(req.url))
    return "external";
  return "block";
}

// The page's own postMessage(…, "*") to its parent reaches the app; nothing
// else is bridged. Mirrors the iframe contract the web uses.
export const BRIDGE = `(function(){
  var send = function(d){ try { window.ReactNativeWebView.postMessage(JSON.stringify(d)); } catch (e) {} };
  try { Object.defineProperty(window, "parent", { value: { postMessage: function(d){ send(d); } } }); } catch (e) {}
  var report = function(){ send({ agentosArtifactHeight: document.documentElement.scrollHeight }); };
  window.addEventListener("load", report);
  try { new ResizeObserver(report).observe(document.documentElement); } catch (e) {}
})(); true;`;

// Diagram source goes in as JSON with "<" escaped, so it can't close the
// script; mermaid itself is injected by the app (from the machine) and runs
// at securityLevel "strict". The page may fetch nothing at all.
export const MERMAID_CSP =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; frame-src 'none'";

export function mermaidHtml(code: string, dark: boolean): string {
  const source = JSON.stringify(code).replace(/</g, "\\u003c");
  const bg = dark ? "#0b0b10" : "#ffffff";
  return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${MERMAID_CSP}">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=4">
<style>html,body{margin:0;background:${bg};}#d{padding:12px;display:flex;justify-content:center}svg{max-width:100%;height:auto}</style>
</head><body><div id="d"></div><script>
(function(){
  var send = function(d){ try { window.ReactNativeWebView.postMessage(JSON.stringify(d)); } catch (e) {} };
  if (!window.mermaid) { send({ mermaidError: true }); return; }
  mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: ${dark ? '"dark"' : '"default"'} });
  mermaid.render("m", ${source}).then(function(r){
    document.getElementById("d").innerHTML = r.svg;
    send({ agentosArtifactHeight: document.documentElement.scrollHeight });
  }).catch(function(){ send({ mermaidError: true }); });
})();
</script></body></html>`;
}

// What crosses back from a page: small messages only, at most ten a second.
export const MAX_MESSAGE = 512;
export const MESSAGE_GAP_MS = 100;

// A link opens Safari only when the user touched this WebView just before:
// a script's own .click() reports as a tap too.
export const TAP_WINDOW_MS = 1000;

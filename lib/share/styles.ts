/**
 * The stylesheet inlined into a shared page. The colours are the app's
 * default light and dark themes (styles/themes.css, checked by a test), under
 * prefers-color-scheme, so a snapshot looks like the chat it came from.
 */

export const LIGHT = {
  background: "240 10% 95.5%",
  foreground: "240 12% 14%",
  card: "0 0% 100%",
  primary: "262 83% 58%",
  "primary-foreground": "0 0% 100%",
  muted: "240 16% 94%",
  "muted-foreground": "240 6% 46%",
  border: "240 14% 88%",
  destructive: "352 80% 56%",
};

export const DARK = {
  background: "240 18% 3.5%",
  foreground: "240 10% 93%",
  card: "240 14% 6%",
  primary: "262 92% 68%",
  "primary-foreground": "0 0% 100%",
  muted: "240 12% 10%",
  "muted-foreground": "240 6% 58%",
  border: "240 10% 15%",
  destructive: "352 85% 62%",
};

const vars = (v: Record<string, string>) =>
  Object.entries(v)
    .map(([k, val]) => `--${k}:${val};`)
    .join("");

// Syntax colours, One Light and One Dark as the chat uses.
const TOKENS_LIGHT = `.token.comment,.token.prolog,.token.cdata{color:#a0a1a7;font-style:italic}.token.keyword,.token.selector,.token.atrule{color:#a626a4}.token.string,.token.char,.token.attr-value,.token.inserted{color:#50a14f}.token.number,.token.boolean,.token.constant,.token.symbol{color:#986801}.token.function,.token.class-name{color:#4078f2}.token.tag,.token.property,.token.deleted{color:#e45649}.token.operator,.token.punctuation{color:#383a42}.token.builtin,.token.attr-name{color:#c18401}`;
const TOKENS_DARK = `.token.comment,.token.prolog,.token.cdata{color:#5c6370;font-style:italic}.token.keyword,.token.selector,.token.atrule{color:#c678dd}.token.string,.token.char,.token.attr-value,.token.inserted{color:#98c379}.token.number,.token.boolean,.token.constant,.token.symbol{color:#d19a66}.token.function,.token.class-name{color:#61afef}.token.tag,.token.property,.token.deleted{color:#e06c75}.token.operator,.token.punctuation{color:#abb2bf}.token.builtin,.token.attr-name{color:#e5c07b}`;

export const STYLES = `
:root{color-scheme:light dark;${vars(LIGHT)}}
${TOKENS_LIGHT}
@media (prefers-color-scheme:dark){:root{${vars(DARK)}}${TOKENS_DARK}}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:hsl(var(--background));color:hsl(var(--foreground));font:15px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif}
.wrap{max-width:760px;margin:0 auto;padding:24px 16px 64px}
header{margin-bottom:24px;padding-bottom:16px;border-bottom:1px solid hsl(var(--border))}
h1.title{margin:0 0 4px;font-size:20px;line-height:1.3}
.meta{margin:0;color:hsl(var(--muted-foreground));font-size:13px}
.msg{margin:16px 0}
.user{display:flex;justify-content:flex-end}
.user .bubble{max-width:85%;background:hsl(var(--muted));border-radius:14px;padding:8px 14px;white-space:pre-wrap;overflow-wrap:anywhere}
.assistant,.plan{overflow-wrap:anywhere}
.plan{background:hsl(var(--card));border:1px solid hsl(var(--border));border-radius:12px;padding:4px 16px}
.plan>.kicker{margin-top:12px}
.kicker{font-size:12px;font-weight:600;color:hsl(var(--muted-foreground));text-transform:uppercase;letter-spacing:.04em}
.error{color:hsl(var(--destructive));border:1px solid hsl(var(--destructive)/.4);border-radius:10px;padding:8px 14px;white-space:pre-wrap;overflow-wrap:anywhere}
.divider{display:flex;align-items:center;gap:12px;color:hsl(var(--muted-foreground));font-size:12px}
.divider::before,.divider::after{content:"";flex:1;border-top:1px solid hsl(var(--border))}
details.tool{border:1px solid hsl(var(--border));border-radius:10px;background:hsl(var(--card))}
details.tool summary{cursor:pointer;padding:8px 12px;font-size:13px;color:hsl(var(--muted-foreground));overflow-wrap:anywhere}
details.tool pre{margin:0;padding:10px 12px;border-top:1px solid hsl(var(--border));max-height:420px;overflow:auto}
.assistant>:first-child{margin-top:0}.assistant>:last-child{margin-bottom:0}
p,ul,ol,blockquote,table,pre{margin:.7em 0}
a{color:hsl(var(--primary))}
blockquote{margin-left:0;padding-left:12px;border-left:3px solid hsl(var(--border));color:hsl(var(--muted-foreground))}
code{font:13px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace}
:not(pre)>code{background:hsl(var(--muted));border-radius:5px;padding:1px 5px}
pre{background:hsl(var(--card));border:1px solid hsl(var(--border));border-radius:10px;padding:12px 14px;overflow:auto;font:13px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace}
pre code{background:none;padding:0}
table{border-collapse:collapse;display:block;overflow:auto}
th,td{border:1px solid hsl(var(--border));padding:6px 10px;text-align:left}
th{background:hsl(var(--muted))}
img{max-width:100%}
.artifact{border:1px solid hsl(var(--border));border-radius:12px;overflow:hidden;background:hsl(var(--card))}
.artifact .kicker{padding:8px 12px;border-bottom:1px solid hsl(var(--border))}
.artifact iframe{display:block;width:100%;border:0}
footer{margin-top:40px;padding-top:16px;border-top:1px solid hsl(var(--border));color:hsl(var(--muted-foreground));font-size:12px}
@media (max-width:520px){.wrap{padding:16px 12px 48px}.user .bubble{max-width:95%}}
`
  .trim()
  .replace(/\n+/g, "\n");

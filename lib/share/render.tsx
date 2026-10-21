/**
 * A snapshot as one self-contained HTML page: inline CSS, no script, no
 * request on load. Output depends only on (snapshot, sharedAt), so what the
 * preview showed is byte-for-byte what gets uploaded.
 *
 * Markdown goes through react-markdown with raw HTML off (the default: do
 * not add rehype-raw), so nothing a message says becomes markup.
 */

import { isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "./static-markup";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as Highlighter } from "react-syntax-highlighter";
import type { Snapshot, SnapshotItem } from "./snapshot";
import { STYLES } from "./styles";

export const MAX_SHARE_BYTES = 5 * 1024 * 1024;

const escape = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const METAS = `<meta name="robots" content="noindex,nofollow"><meta name="referrer" content="no-referrer"><meta name="color-scheme" content="light dark">`;

function textOf(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isValidElement<{ children?: ReactNode }>(node))
    return textOf(node.props.children);
  return "";
}

const components: Components = {
  pre: ({ children }) => <>{children}</>,
  code({ className, children }) {
    const language = className?.match(/language-([\w+-]+)/)?.[1];
    const text = textOf(children);
    if (!language && !text.includes("\n")) return <code>{children}</code>;
    return (
      <Highlighter
        language={language ?? "text"}
        useInlineStyles={false}
        PreTag="pre"
        CodeTag="code"
      >
        {text.replace(/\n$/, "")}
      </Highlighter>
    );
  },
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  ),
  // A remote image would phone home when the page is opened.
  img: ({ alt }) => <span>[image{alt ? `: ${alt}` : ""}]</span>,
};

export function Markdown({ text }: { text: string }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
      {text}
    </ReactMarkdown>
  );
}

function Item({ item }: { item: SnapshotItem }) {
  switch (item.type) {
    case "user":
      return (
        <div className="msg user">
          <div className="bubble">{item.text}</div>
        </div>
      );
    case "assistant":
      return (
        <div className="msg assistant">
          <Markdown text={item.text} />
        </div>
      );
    case "plan":
      return (
        <div className="msg plan">
          <div className="kicker">Plan</div>
          <Markdown text={item.text} />
        </div>
      );
    case "error":
      return <div className="msg error">{item.text}</div>;
    case "divider":
      return <div className="msg divider">{item.text}</div>;
    case "artifact":
      return (
        <div className="msg artifact">
          <div className="kicker">{item.label}</div>
          <iframe
            sandbox="allow-scripts"
            referrerPolicy="no-referrer"
            loading="lazy"
            title={item.label}
            style={{ height: item.height ?? 480 }}
            srcDoc={withMetas(item.html ?? "")}
          />
        </div>
      );
    case "detail":
      return (
        <details className="msg tool">
          <summary>{item.label}</summary>
          <pre>{item.text}</pre>
        </details>
      );
  }
}

export function renderChatSnapshot(
  snapshot: Snapshot,
  opts: { sharedAt: string }
): string {
  const body = renderToStaticMarkup(
    <>
      {snapshot.items.map((item) => (
        <Item key={item.id} item={item} />
      ))}
    </>
  );
  const date = opts.sharedAt.slice(0, 10);
  const note = snapshot.toolsHidden
    ? " · Read-only snapshot; tool calls hidden"
    : " · Read-only snapshot";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${METAS}<title>${escape(snapshot.title)}</title><style>${STYLES}</style></head><body><div class="wrap"><header><h1 class="title">${escape(snapshot.title)}</h1><p class="meta">Shared from AgentOS · ${escape(date)}${note}</p></header><main>${body}</main><footer>Made with <a href="https://github.com/saadnvd1/agent-os" target="_blank" rel="noopener noreferrer">AgentOS</a></footer></div></body></html>`;
}

/** An artifact's page with the privacy metas added to its head. */
export function withMetas(html: string): string {
  if (/<head[\s>]/i.test(html))
    return html.replace(/<head(\s[^>]*)?>/i, (m) => m + METAS);
  if (/<html[\s>]/i.test(html))
    return html.replace(
      /<html(\s[^>]*)?>/i,
      (m) => `${m}<head>${METAS}</head>`
    );
  return `<!doctype html><html><head><meta charset="utf-8">${METAS}</head><body>${html}</body></html>`;
}

export function renderArtifactSnapshot(html: string, title: string): string {
  const page = withMetas(html);
  return /<title[\s>]/i.test(page)
    ? page
    : page.replace(
        /<head(\s[^>]*)?>/i,
        (m) => `${m}<title>${escape(title)}</title>`
      );
}

export const tooBig = (html: string) =>
  Buffer.byteLength(html, "utf8") > MAX_SHARE_BYTES;

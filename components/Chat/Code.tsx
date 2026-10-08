"use client";

import { memo, type CSSProperties, type ReactNode } from "react";
import { useTheme } from "next-themes";
import {
  PrismAsyncLight as SyntaxHighlighter,
  type createElementProps,
} from "react-syntax-highlighter";
import createElement from "react-syntax-highlighter/dist/esm/create-element";
import { LRU } from "@/lib/lru";
import oneDark from "react-syntax-highlighter/dist/esm/styles/prism/one-dark";
import oneLight from "react-syntax-highlighter/dist/esm/styles/prism/one-light";
import { CopyButton } from "./CopyButton";
import { Mermaid } from "./Mermaid";

const ALIASES: Record<string, string> = {
  sh: "bash",
  shell: "bash",
  zsh: "bash",
  console: "bash",
  ts: "typescript",
  js: "javascript",
  py: "python",
  rb: "ruby",
  yml: "yaml",
  md: "markdown",
};

const CUSTOM_STYLE: CSSProperties = {
  margin: 0,
  padding: 0,
  background: "transparent",
  fontSize: "inherit",
  lineHeight: "inherit",
};
const CODE_STYLE: CSSProperties = {
  background: "transparent",
  fontFamily: "inherit",
};

// Highlighted lines by theme, language and code. A scrolled list remounts
// its messages and a streamed one re-renders every finished block per word;
// both reuse what was highlighted before.
const highlighted = new LRU<ReactNode>(500, 16 * 1024 * 1024);

// Whether a highlight is the real one, not plain text while the language loads.
const Async = SyntaxHighlighter as unknown as {
  astGenerator?: unknown;
  isRegistered?: (lang: string) => boolean;
};
const settled = (lang: string) =>
  !!Async.astGenerator && (lang === "text" || !!Async.isRegistered?.(lang));

type Rows = Pick<createElementProps, "stylesheet" | "useInlineStyles"> & {
  rows: createElementProps["node"][];
};

// Highlighted code with no background of its own, so it sits in whatever
// surface holds it.
export const Highlighted = memo(function Highlighted({
  code,
  language,
  className,
}: {
  code: string;
  language?: string;
  className?: string;
}) {
  const { resolvedTheme } = useTheme();
  const light = resolvedTheme === "light";
  const style = light ? oneLight : oneDark;
  const lang = language ? (ALIASES[language] ?? language) : "text";
  const key = `${light ? "l" : "d"}\0${lang}\0${code}`;
  const cached = highlighted.get(key);
  if (cached !== undefined)
    return (
      <div
        className={className}
        style={{ ...style['pre[class*="language-"]'], ...CUSTOM_STYLE }}
      >
        <code style={{ whiteSpace: "pre", ...CODE_STYLE }}>{cached}</code>
      </div>
    );
  return (
    <SyntaxHighlighter
      language={lang}
      style={style}
      PreTag="div"
      className={className}
      customStyle={CUSTOM_STYLE}
      codeTagProps={{ style: CODE_STYLE }}
      wrapLines={false}
      renderer={({ rows, stylesheet, useInlineStyles }: Rows) => {
        const out = rows.map((node, i) =>
          createElement({
            node,
            stylesheet,
            useInlineStyles,
            key: `code-segment-${i}`,
          })
        );
        if (settled(lang)) highlighted.set(key, out, code.length * 8 + 64);
        return out;
      }}
    >
      {code}
    </SyntaxHighlighter>
  );
});

// A fenced block in a message: its language, a copy button, and the code.
export function CodeBlock({
  code,
  language,
}: {
  code: string;
  language?: string;
}) {
  if (language === "mermaid") return <Mermaid code={code} />;
  return (
    <div className="bg-foreground/[0.04] not-prose my-3 overflow-hidden rounded-xl">
      <div className="text-muted-foreground flex items-center justify-between pr-1 pl-3 font-mono text-[11px]">
        <span>{language || "text"}</span>
        <CopyButton text={code} label="Copy code" />
      </div>
      <div className="overflow-x-auto px-3 pb-3 font-mono text-xs leading-5">
        <Highlighted code={code} language={language} />
      </div>
    </div>
  );
}

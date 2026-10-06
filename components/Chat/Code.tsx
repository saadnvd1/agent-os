"use client";

import { memo } from "react";
import { useTheme } from "next-themes";
import { PrismAsyncLight as SyntaxHighlighter } from "react-syntax-highlighter";
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
  const lang = language ? (ALIASES[language] ?? language) : "text";
  return (
    <SyntaxHighlighter
      language={lang}
      style={resolvedTheme === "light" ? oneLight : oneDark}
      PreTag="div"
      className={className}
      customStyle={{
        margin: 0,
        padding: 0,
        background: "transparent",
        fontSize: "inherit",
        lineHeight: "inherit",
      }}
      codeTagProps={{
        style: { background: "transparent", fontFamily: "inherit" },
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

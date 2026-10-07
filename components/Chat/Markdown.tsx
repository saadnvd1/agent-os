"use client";

import { isValidElement, memo, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { imageType, imageUrl } from "@/lib/artifacts/image-paths";
import { CodeBlock } from "./Code";
import { ImageThumb } from "./ImageThumb";

function textOf(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isValidElement<{ children?: ReactNode }>(node))
    return textOf(node.props.children);
  return "";
}

function LocalImage({ path }: { path: string }) {
  return (
    <span className="my-1 block">
      <ImageThumb src={imageUrl(path)} alt={path.split("/").pop()} />
    </span>
  );
}

const components: Components = {
  // A fenced block arrives as <pre><code class="language-x">.
  pre({ children }) {
    const code = isValidElement<{ className?: string; children?: ReactNode }>(
      children
    )
      ? children
      : null;
    const language = code?.props.className?.match(/language-([\w+-]+)/)?.[1];
    return (
      <CodeBlock
        code={textOf(code?.props.children ?? children).replace(/\n$/, "")}
        language={language}
      />
    );
  },
  // A file the agent wrote, by its absolute path, shows as the image.
  a({ href, children }) {
    const local = href && imageType(href);
    return (
      <>
        <a
          href={local ? imageUrl(href) : href}
          target="_blank"
          rel="noreferrer"
        >
          {children}
        </a>
        {local && <LocalImage path={href} />}
      </>
    );
  },
  img({ src, alt }) {
    if (typeof src !== "string") return null;
    return (
      <ImageThumb
        src={imageType(src) ? imageUrl(src) : src}
        alt={alt ?? ""}
        className="my-1"
      />
    );
  },
  code({ className, children }) {
    const text = textOf(children);
    return (
      <>
        <code className={className}>{children}</code>
        {!className && imageType(text) && <LocalImage path={text} />}
      </>
    );
  },
  table({ children }) {
    return (
      <div className="overflow-x-auto">
        <table>{children}</table>
      </div>
    );
  },
};

export const Markdown = memo(function Markdown({ text }: { text: string }) {
  return (
    <div className="prose prose-sm dark:prose-invert prose-code:before:content-none prose-code:after:content-none prose-code:bg-foreground/[0.06] prose-code:rounded prose-code:px-1 prose-code:py-0.5 prose-code:font-normal max-w-none break-words">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  );
});

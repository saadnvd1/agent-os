import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AssistantMessage } from "./Messages";

const item = {
  id: "a1",
  kind: "assistant",
  text: "Hello\n\n```ts\nx\n```",
  streaming: false,
} as never;

describe("AssistantMessage quote action", () => {
  it("shows a labelled Quote button next to Copy", () => {
    const html = renderToStaticMarkup(
      createElement(AssistantMessage, { item, onQuote: vi.fn() })
    );
    expect(html).toContain('aria-label="Copy message"');
    expect(html).toContain('aria-label="Quote message"');
    expect(html).toContain('title="Quote"');
  });

  it("hands the markdown source to onQuote on click", () => {
    const onQuote = vi.fn();
    const el = AssistantMessage({ item, onQuote }) as never as {
      props: { children: unknown[] };
    };
    const group = (
      el.props.children as { props: { children: unknown[] } }[]
    )[1];
    const button = group.props.children[1] as {
      props: { onClick: () => void };
    };
    button.props.onClick();
    expect(onQuote).toHaveBeenCalledWith("Hello\n\n```ts\nx\n```");
  });

  it("has no Quote button without a handler", () => {
    const html = renderToStaticMarkup(
      createElement(AssistantMessage, { item })
    );
    expect(html).not.toContain("Quote message");
  });
});

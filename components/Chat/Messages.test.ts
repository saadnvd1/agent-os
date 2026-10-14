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

// The element with this aria-label, anywhere in an unrendered tree.
function findByLabel(node: unknown, label: string): unknown {
  if (Array.isArray(node))
    return node.map((n) => findByLabel(n, label)).find(Boolean);
  const props = (node as { props?: Record<string, unknown> } | null)?.props;
  if (!props) return undefined;
  if (props["aria-label"] === label) return node;
  return findByLabel(props.children, label);
}

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
    const button = findByLabel(
      AssistantMessage({ item, onQuote }),
      "Quote message"
    ) as { props: { onClick: () => void } };
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

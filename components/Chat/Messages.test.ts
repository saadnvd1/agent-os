import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AssistantMessage, UserMessage } from "./Messages";

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

describe("a sent message not in the chat yet", () => {
  const user = { id: "user-c-1", kind: "user", text: "An article" } as never;
  const render = (status: "sending" | "accepted" | "failed") =>
    renderToStaticMarkup(
      createElement(UserMessage, {
        item: user,
        pending: {
          status,
          error: "connection lost",
          onRetry: vi.fn(),
          onEdit: vi.fn(),
        },
      })
    );

  it("shows the text at once, dimmed, with its progress", () => {
    expect(render("sending")).toContain("An article");
    expect(render("sending")).toContain("opacity-60");
    expect(render("sending")).toContain("Sending");
    expect(render("accepted")).toContain("Starting the agent");
  });

  it("says a failed one wasn't sent, with Retry and Edit", () => {
    const html = render("failed");
    expect(html).toContain("Not sent · connection lost");
    expect(html).toContain(">Retry</button>");
    expect(html).toContain(">Edit</button>");
    expect(html).not.toContain("opacity-60");
  });

  it("a message in the chat shows no status", () => {
    const html = renderToStaticMarkup(
      createElement(UserMessage, { item: user })
    );
    expect(html).not.toContain("Sending");
    expect(html).not.toContain("Not sent");
  });
});

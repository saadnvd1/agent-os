import type { ChatCommand, ChatItem, ChatModel } from "../../lib/chat/events";

// A finished turn in the storefront project: the agent finds a rounding bug,
// plans, edits with a diff, and runs the tests. Every kind of item the chat
// view draws appears once.

const FILE = "~/code/storefront/src/checkout/totals.ts";
const TEST = "~/code/storefront/src/checkout/totals.test.ts";

export function checkoutConversation(start: number): ChatItem[] {
  let t = start;
  const at = (secs: number) => (t += secs * 1000);
  const tool = (
    id: string,
    name: string,
    title: string,
    input: Record<string, unknown>,
    output?: string
  ): ChatItem => ({
    id,
    createdAt: at(2),
    kind: "tool",
    name,
    title,
    input,
    status: "done",
    output,
  });

  return [
    {
      id: "user-1",
      createdAt: at(0),
      kind: "user",
      text: "Checkout totals are a cent off when a discount and tax both apply. Find out why and fix it, with a test.",
    },
    tool("tool-skill", "Skill", "Skill: debugging", { skill: "debugging" }),
    tool(
      "tool-grep",
      "Grep",
      'Search "applyDiscount"',
      { pattern: "applyDiscount" },
      "src/checkout/totals.ts:4\nsrc/checkout/totals.ts:10"
    ),
    tool("tool-read-1", "Read", "Read checkout/totals.ts", { file_path: FILE }),
    tool("tool-read-2", "Read", "Read checkout/totals.test.ts", {
      file_path: TEST,
    }),
    tool(
      "tool-bash-1",
      "Bash",
      "npx vitest run src/checkout",
      { command: "npx vitest run src/checkout" },
      "✓ adds tax\n1 passed"
    ),
    {
      id: "assistant-1",
      createdAt: at(3),
      kind: "assistant",
      text: [
        "Found it. `cartTotal` rounds **each line** after the discount, then rounds the tax on the sum. Three items at $3.33 with 10% off each round up to $3.00, so the cart comes out a cent high.",
        "",
        "The fix is to discount the gross subtotal once, then apply tax:",
      ].join("\n"),
    },
    {
      id: "todos-1",
      createdAt: at(1),
      kind: "todos",
      todos: [
        { text: "Reproduce with a failing test", status: "completed" },
        {
          text: "Discount the subtotal once, not per line",
          status: "completed",
        },
        { text: "Run the checkout suite", status: "completed" },
      ],
    },
    {
      id: "tool-edit-test",
      createdAt: at(2),
      kind: "tool",
      name: "Edit",
      title: "Edit checkout/totals.test.ts",
      input: { file_path: TEST },
      status: "done",
      diff: {
        path: TEST,
        before: "  });\n});",
        after: [
          "  });",
          "",
          '  it("rounds once after the discount", () => {',
          "    const items = [1, 2, 3].map((n) => ({ sku: `s${n}`, price: 333, qty: 1 }));",
          '    expect(cartTotal({ items, discount: 10, region: "CA" })).toBe(964);',
          "  });",
          "});",
        ].join("\n"),
      },
    },
    {
      id: "tool-edit",
      createdAt: at(2),
      kind: "tool",
      name: "Edit",
      title: "Edit checkout/totals.ts",
      input: { file_path: FILE },
      status: "done",
      diff: {
        path: FILE,
        before: [
          "  const subtotal = cart.items.reduce(",
          "    (sum, item) => sum + applyDiscount(item.price * item.qty, cart.discount),",
          "    0",
          "  );",
        ].join("\n"),
        after: [
          "  const gross = cart.items.reduce((sum, i) => sum + i.price * i.qty, 0);",
          "  const subtotal = applyDiscount(gross, cart.discount);",
        ].join("\n"),
      },
    },
    tool(
      "tool-bash-2",
      "Bash",
      "npx vitest run src/checkout",
      { command: "npx vitest run src/checkout" },
      "✓ adds tax\n✓ rounds once after the discount\n2 passed"
    ),
    {
      id: "assistant-2",
      createdAt: at(4),
      kind: "assistant",
      text: [
        "Fixed. The discount now applies to the gross subtotal, so rounding happens once.",
        "",
        "- `src/checkout/totals.ts`: discount the sum, not each line",
        "- `totals.test.ts`: a three-item cart at 10% off now totals **$9.64**",
        "",
        "Both checkout tests pass. Want me to open a PR?",
      ].join("\n"),
    },
    {
      id: "turn-1",
      createdAt: at(1),
      kind: "turn_end",
      durationMs: 42000,
    },
  ];
}

export function docsConversation(start: number): ChatItem[] {
  return [
    {
      id: "user-1",
      createdAt: start,
      kind: "user",
      text: "Add client-side search to the docs sidebar",
    },
    {
      id: "assistant-1",
      createdAt: start + 30000,
      kind: "assistant",
      text: "Search is in. It builds a small index at build time and filters as you type.",
    },
    {
      id: "turn-1",
      createdAt: start + 31000,
      kind: "turn_end",
      durationMs: 31000,
    },
  ];
}

// What the composer's slash menu offers. The demo replaces whatever the
// machine's own agent would report, so no local skill or plugin shows.
export const COMMANDS: ChatCommand[] = [
  {
    name: "review",
    description: "Review the changes on this branch",
    builtin: true,
  },
  {
    name: "test",
    description: "Run the test suite and fix what fails",
    argumentHint: "[path]",
  },
  {
    name: "plan",
    description: "Plan the change before writing code",
    argumentHint: "<goal>",
  },
  { name: "pr", description: "Open a pull request for this branch" },
  {
    name: "debugging",
    description: "Find the root cause before fixing anything",
  },
  {
    name: "release-notes",
    description: "Draft release notes from merged PRs",
    argumentHint: "<version>",
  },
  {
    name: "compact",
    description: "Summarize the conversation to free up context",
    builtin: true,
  },
  {
    name: "model",
    description: "Switch the model for this conversation",
    builtin: true,
  },
  { name: "clear", description: "Start a fresh conversation", builtin: true },
];

export const MODELS: ChatModel[] = [
  { value: "opus", label: "Opus", description: "Most capable" },
  { value: "sonnet", label: "Sonnet", description: "Fast and capable" },
  { value: "haiku", label: "Haiku", description: "Fastest" },
];

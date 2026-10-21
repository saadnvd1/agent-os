import { describe, expect, it } from "vitest";
import type { ChatItem } from "./events";
import { condenseItems } from "../bus/condense";

describe("a turn that ended early", () => {
  it("is not read as a plain end by the bus summary", () => {
    const items: ChatItem[] = [
      {
        id: "t",
        kind: "turn_end",
        createdAt: 1,
        ended: { reason: "no_tool_call", notice: "n" },
      },
    ];
    expect(JSON.stringify(condenseItems(items))).toContain(
      "turn ended early: no_tool_call"
    );
  });
});

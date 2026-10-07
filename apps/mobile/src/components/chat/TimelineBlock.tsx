import { memo } from "react";
import { View } from "react-native";
import { Text } from "~/components/ui/Text";
import type { ApprovalDecision, ChatItem } from "@/lib/chat/events";
import type { TimelineBlock as Block } from "@/lib/chat/group";
import { font, radius, space, useTheme } from "~/lib/theme";
import { Approval } from "./blocks/Approval";
import { Line } from "./blocks/Line";
import { Todos } from "./blocks/Todos";
import { TurnEnd } from "./blocks/TurnEnd";
import { ToolGroup } from "./blocks/ToolGroup";
import { UserMessage } from "./blocks/UserMessage";
import { Markdown } from "./markdown/Markdown";

type Respond = (id: string, d: ApprovalDecision) => void;

export const TimelineBlock = memo(function TimelineBlock({
  block,
  respond,
}: {
  block: Block;
  respond: Respond;
}) {
  if (block.type === "tools") return <ToolGroup tools={block.tools} />;
  if (block.type === "undone")
    return (
      <Line
        icon="arrow.uturn.backward"
        text={`Undone: ${block.items.length} messages, ${block.undo.filesChanged} files`}
      />
    );
  return <Item item={block.item} respond={respond} />;
});

function Item({ item, respond }: { item: ChatItem; respond: Respond }) {
  const t = useTheme();
  switch (item.kind) {
    case "user":
      return <UserMessage item={item} />;
    case "assistant":
      return item.text ? <Markdown text={item.text} /> : null;
    case "reasoning":
      return item.text ? (
        <Text
          numberOfLines={3}
          style={{
            color: t.faint,
            fontSize: font.size.sm,
            fontStyle: "italic",
            lineHeight: 19,
          }}
        >
          {item.text}
        </Text>
      ) : null;
    case "tool":
      return <ToolGroup tools={[item]} />;
    case "todos":
      return <Todos item={item} />;
    case "approval":
      return <Approval item={item} respond={respond} />;
    case "plan":
      return (
        <View
          style={{
            backgroundColor: t.card,
            borderRadius: radius.md,
            padding: space.md,
            gap: space.sm,
          }}
        >
          <Text
            style={{
              color: t.primary,
              fontSize: font.size.xs,
              fontWeight: "700",
            }}
          >
            PLAN{item.carried ? " · CARRIED OUT" : ""}
          </Text>
          <Markdown text={item.plan} />
        </View>
      );
    case "turn_end":
      return <TurnEnd item={item} />;
    case "error":
      return (
        <Line
          icon="exclamationmark.triangle"
          text={item.message}
          tone="destructive"
        />
      );
    case "note":
      return (
        <Line
          icon="text.bubble"
          text={item.text}
          tone={item.tone === "note" ? "muted" : "warning"}
        />
      );
    case "compacted":
      return (
        <Line
          icon="rectangle.compress.vertical"
          text="Conversation compacted"
        />
      );
    case "command_output":
      return (
        <Text
          selectable
          style={{
            color: t.muted,
            fontFamily: font.mono,
            fontSize: 12,
            lineHeight: 17,
          }}
        >
          {item.text}
        </Text>
      );
    case "artifact":
      return (
        <Line
          icon="macwindow"
          text={`${item.title}: open on the web to view`}
        />
      );
    case "mcp":
      return (
        <Line
          icon="puzzlepiece.extension"
          text={`${item.servers.length} MCP servers`}
        />
      );
    case "undo":
      return (
        <Line
          icon="arrow.uturn.backward"
          text={`Undid ${item.filesChanged} file changes`}
        />
      );
    default:
      return null;
  }
}

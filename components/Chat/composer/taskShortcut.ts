import { Extension, InputRule } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";

// "- [ ] " typed GitHub style: the "- " has already made a bullet list, so
// "[ ] " in its only item turns it into a task list instead of nesting one.
export const TaskShortcut = Extension.create({
  name: "taskShortcut",
  priority: 1000,
  addInputRules() {
    return [
      new InputRule({
        find: /^\[([ xX]?)\]\s$/,
        handler: ({ state, range, match }) => {
          const $from = state.doc.resolve(range.from);
          if ($from.depth < 3) return null;
          const list = $from.node(-2);
          if (list.type.name !== "bulletList" || list.childCount !== 1)
            return null;
          if ($from.parent.textContent.trim() !== match[0].trim()) return null;
          const { taskList, taskItem, paragraph } = state.schema.nodes;
          const pos = $from.before(-2);
          const checked = match[1].toLowerCase() === "x";
          const { tr } = state;
          tr.replaceWith(
            pos,
            pos + list.nodeSize,
            taskList.create(
              { marker: list.attrs.marker ?? "-" },
              taskItem.create({ checked }, paragraph.create())
            )
          );
          tr.setSelection(TextSelection.create(tr.doc, pos + 3));
        },
      }),
    ];
  },
});

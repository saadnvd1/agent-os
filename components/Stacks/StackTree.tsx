import type { StackItemView } from "@/lib/stacks/types";
import { treeOrder } from "@/lib/stacks/tree";
import { StackItemRow } from "./StackItemRow";

export function StackTree({
  items,
  stackId,
}: {
  items: StackItemView[];
  stackId?: string;
}) {
  return (
    <div className="space-y-1.5">
      {treeOrder(items).map((item) => (
        <StackItemRow key={item.id} item={item} stackId={stackId} />
      ))}
    </div>
  );
}

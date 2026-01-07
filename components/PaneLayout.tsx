"use client";

import { Panel, Group, Separator } from "react-resizable-panels";
import type { PaneLayout as PaneLayoutType } from "@/lib/panes";
import { usePanes } from "@/contexts/PaneContext";

interface PaneLayoutProps {
  layout: PaneLayoutType;
  renderPane: (paneId: string) => React.ReactNode;
}

function ResizeHandle({ orientation }: { orientation: "horizontal" | "vertical" }) {
  return (
    <Separator
      className={`
        ${orientation === "horizontal" ? "w-1 cursor-col-resize" : "h-1 cursor-row-resize"}
        bg-border hover:bg-primary/50 transition-colors
        flex items-center justify-center
      `}
    >
      <div
        className={`
          ${orientation === "horizontal" ? "w-0.5 h-8" : "h-0.5 w-8"}
          bg-muted-foreground/30 rounded-full
        `}
      />
    </Separator>
  );
}

function LayoutRenderer({ layout, renderPane }: PaneLayoutProps) {
  if (layout.type === "leaf") {
    return <>{renderPane(layout.paneId)}</>;
  }

  const orientation = layout.direction;

  return (
    <Group orientation={orientation} className="h-full">
      {layout.children.map((child, index) => (
        <div key={child.type === "leaf" ? child.paneId : index} className="contents">
          <Panel
            defaultSize={layout.sizes[index]}
            minSize={15}
            className="h-full"
          >
            <LayoutRenderer layout={child} renderPane={renderPane} />
          </Panel>
          {index < layout.children.length - 1 && (
            <ResizeHandle orientation={layout.direction} />
          )}
        </div>
      ))}
    </Group>
  );
}

export function PaneLayout({
  renderPane,
}: {
  renderPane: (paneId: string) => React.ReactNode;
}) {
  const { state } = usePanes();
  return (
    <div className="h-full w-full">
      <LayoutRenderer layout={state.layout} renderPane={renderPane} />
    </div>
  );
}

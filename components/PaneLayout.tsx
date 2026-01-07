"use client";

import { Fragment } from "react";
import { Panel, Group, Separator } from "react-resizable-panels";
import type { PaneLayout as PaneLayoutType } from "@/lib/panes";
import { usePanes } from "@/contexts/PaneContext";

interface PaneLayoutProps {
  layout: PaneLayoutType;
  renderPane: (paneId: string) => React.ReactNode;
}

function LayoutRenderer({ layout, renderPane }: PaneLayoutProps) {
  if (layout.type === "leaf") {
    return <>{renderPane(layout.paneId)}</>;
  }

  const orientation = layout.direction;

  return (
    <Group orientation={orientation} className="h-full">
      {layout.children.map((child, index) => (
        <Fragment key={child.type === "leaf" ? child.paneId : index}>
          <Panel
            defaultSize={layout.sizes[index]}
            minSize={15}
            className="h-full"
          >
            <LayoutRenderer layout={child} renderPane={renderPane} />
          </Panel>
          {index < layout.children.length - 1 && (
            <Separator
              className={`
                ${orientation === "horizontal" ? "w-1.5 cursor-col-resize" : "h-1.5 cursor-row-resize"}
                bg-border hover:bg-primary/50 active:bg-primary transition-colors
                flex items-center justify-center
              `}
            />
          )}
        </Fragment>
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

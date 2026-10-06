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
              className={` ${orientation === "horizontal" ? "mx-1 w-px cursor-col-resize" : "my-1 h-px cursor-row-resize"} hover:bg-primary/50 active:bg-primary/70 rounded-full bg-transparent transition-colors`}
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
  const { state, isMobile, focusedPaneId } = usePanes();

  // On mobile: only render the focused pane (single pane mode)
  if (isMobile) {
    return <div className="h-full w-full">{renderPane(focusedPaneId)}</div>;
  }

  // On desktop: render full layout tree with splits
  return (
    <div className="h-full w-full p-1.5">
      <LayoutRenderer layout={state.layout} renderPane={renderPane} />
    </div>
  );
}

import { NextResponse } from "next/server";
import { db, queries, type Group } from "@/lib/db";

// GET /api/groups/[...path] - Get a single group
export async function GET(
  request: Request,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path: pathParts } = await params;
  const path = pathParts.join("/");

  try {
    const group = queries.getGroup(db).get(path) as Group | undefined;

    if (!group) {
      return NextResponse.json({ error: "Group not found" }, { status: 404 });
    }

    return NextResponse.json({
      group: { ...group, expanded: Boolean(group.expanded) },
    });
  } catch (error) {
    console.error("Error fetching group:", error);
    return NextResponse.json(
      { error: "Failed to fetch group" },
      { status: 500 }
    );
  }
}

// PATCH /api/groups/[...path] - Update group (name, expanded, order)
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path: pathParts } = await params;
  const path = pathParts.join("/");

  try {
    const body = await request.json();
    const { name, expanded, sort_order } = body;

    // Check if group exists
    const group = queries.getGroup(db).get(path) as Group | undefined;
    if (!group) {
      return NextResponse.json({ error: "Group not found" }, { status: 404 });
    }

    // Protect default group from being renamed
    if (path === "sessions" && name !== undefined && name !== "Sessions") {
      return NextResponse.json(
        { error: "Cannot rename the default group" },
        { status: 400 }
      );
    }

    // Update name
    if (name !== undefined) {
      queries.updateGroupName(db).run(name, path);
    }

    // Update expanded state
    if (expanded !== undefined) {
      queries.updateGroupExpanded(db).run(expanded ? 1 : 0, path);
    }

    // Update sort order
    if (sort_order !== undefined) {
      queries.updateGroupOrder(db).run(sort_order, path);
    }

    const updatedGroup = queries.getGroup(db).get(path) as Group;
    return NextResponse.json({
      group: { ...updatedGroup, expanded: Boolean(updatedGroup.expanded) },
    });
  } catch (error) {
    console.error("Error updating group:", error);
    return NextResponse.json(
      { error: "Failed to update group" },
      { status: 500 }
    );
  }
}

// DELETE /api/groups/[...path] - Delete group (moves sessions to parent or default)
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path: pathParts } = await params;
  const path = pathParts.join("/");

  try {
    // Protect default group
    if (path === "sessions") {
      return NextResponse.json(
        { error: "Cannot delete the default group" },
        { status: 400 }
      );
    }

    // Check if group exists
    const group = queries.getGroup(db).get(path) as Group | undefined;
    if (!group) {
      return NextResponse.json({ error: "Group not found" }, { status: 404 });
    }

    // Find parent group or use default
    const pathParts2 = path.split("/");
    pathParts2.pop();
    const parentPath =
      pathParts2.length > 0 ? pathParts2.join("/") : "sessions";

    // Move all sessions in this group to parent
    queries.moveSessionsToGroup(db).run(parentPath, path);

    // Also move sessions from any subgroups
    const allGroups = queries.getAllGroups(db).all() as Group[];
    const subgroups = allGroups.filter((g) => g.path.startsWith(path + "/"));
    for (const subgroup of subgroups) {
      queries.moveSessionsToGroup(db).run(parentPath, subgroup.path);
      queries.deleteGroup(db).run(subgroup.path);
    }

    // Delete the group
    queries.deleteGroup(db).run(path);

    return NextResponse.json({ success: true, movedTo: parentPath });
  } catch (error) {
    console.error("Error deleting group:", error);
    return NextResponse.json(
      { error: "Failed to delete group" },
      { status: 500 }
    );
  }
}

import { NextRequest, NextResponse } from "next/server";
import {
  createSSHConnection,
  listSSHConnections,
} from "@/lib/ssh-connections";
import { testSSHConnection, checkRemoteDependencies } from "@/lib/ssh";

// GET /api/ssh-connections - List all SSH connections
export async function GET() {
  try {
    const connections = listSSHConnections();
    return NextResponse.json({ connections });
  } catch (error: unknown) {
    const err = error as { message?: string };
    console.error("Error listing SSH connections:", error);
    return NextResponse.json(
      { error: err.message || "Failed to list SSH connections" },
      { status: 500 }
    );
  }
}

// POST /api/ssh-connections - Create new SSH connection
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    // Validate required fields
    if (!body.name || !body.host || !body.user) {
      return NextResponse.json(
        { error: "Missing required fields: name, host, user" },
        { status: 400 }
      );
    }

    // Create the connection
    const connection = createSSHConnection({
      name: body.name,
      host: body.host,
      port: body.port || 22,
      user: body.user,
      key_path: body.key_path || null,
    });

    // Test connection immediately
    const testResult = await testSSHConnection(connection);
    if (!testResult.success) {
      return NextResponse.json(
        { error: `Connection test failed: ${testResult.error}` },
        { status: 400 }
      );
    }

    // Check for required dependencies
    const deps = await checkRemoteDependencies(connection);
    if (!deps.tmux || !deps.git) {
      const missing = [];
      if (!deps.tmux) missing.push("tmux");
      if (!deps.git) missing.push("git");
      return NextResponse.json(
        {
          error: `Remote host missing required tools: ${missing.join(", ")}`,
          connection,
          dependencies: deps,
        },
        { status: 400 }
      );
    }

    return NextResponse.json({ connection, dependencies: deps }, { status: 201 });
  } catch (error: unknown) {
    const err = error as { message?: string };
    console.error("Error creating SSH connection:", error);
    return NextResponse.json(
      { error: err.message || "Failed to create SSH connection" },
      { status: 500 }
    );
  }
}

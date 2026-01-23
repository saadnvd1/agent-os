import { NextRequest, NextResponse } from "next/server";
import { getSSHConnectionById } from "@/lib/ssh-connections";
import { testSSHConnection, checkRemoteDependencies } from "@/lib/ssh";

interface RouteParams {
  params: Promise<{ id: string }>;
}

// POST /api/ssh-connections/[id]/test - Test SSH connection
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;

    const connection = getSSHConnectionById(id);
    if (!connection) {
      return NextResponse.json(
        { error: "SSH connection not found" },
        { status: 404 }
      );
    }

    // Test basic connectivity
    const testResult = await testSSHConnection(connection);
    if (!testResult.success) {
      return NextResponse.json({
        success: false,
        error: testResult.error,
        dependencies: { tmux: false, git: false, claude: false },
      });
    }

    // Check for dependencies
    const deps = await checkRemoteDependencies(connection);

    return NextResponse.json({
      success: true,
      dependencies: deps,
    });
  } catch (error: unknown) {
    const err = error as { message?: string };
    console.error("Error testing SSH connection:", error);
    return NextResponse.json(
      {
        success: false,
        error: err.message || "Connection test failed",
        dependencies: { tmux: false, git: false, claude: false },
      },
      { status: 500 }
    );
  }
}

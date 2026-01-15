import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  getAuthConfig,
  verifyJwt,
  createSession,
  getSession,
  deleteSession,
  cleanupExpiredSessions,
} from "@/lib/auth";

const COOKIE_NAME = "agentos_session";

// GET /api/auth - Check auth status
export async function GET() {
  try {
    const config = getAuthConfig();

    if (!config.enabled) {
      return NextResponse.json({ authenticated: true, mode: "disabled" });
    }

    const cookieStore = await cookies();
    const sessionCookie = cookieStore.get(COOKIE_NAME);

    if (!sessionCookie) {
      return NextResponse.json({ authenticated: false, mode: config.mode });
    }

    const session = getSession(sessionCookie.value);
    if (!session) {
      return NextResponse.json({ authenticated: false, mode: config.mode });
    }

    return NextResponse.json({ authenticated: true, mode: config.mode });
  } catch (error) {
    console.error("Auth check error:", error);
    return NextResponse.json(
      { error: "Failed to check auth status" },
      { status: 500 }
    );
  }
}

// POST /api/auth - Login (password mode) or verify token (JWT mode)
export async function POST(request: NextRequest) {
  try {
    const config = getAuthConfig();

    if (!config.enabled) {
      return NextResponse.json({ success: true, mode: "disabled" });
    }

    const body = await request.json();

    if (config.mode === "jwt" && body.token) {
      if (!config.secret) {
        return NextResponse.json(
          { error: "Auth not configured" },
          { status: 500 }
        );
      }

      const result = verifyJwt(body.token, config.secret);
      if (!result.valid) {
        return NextResponse.json(
          { error: result.error || "Invalid token" },
          { status: 401 }
        );
      }

      const { sessionId, expiresAt } = createSession();
      cleanupExpiredSessions();

      const response = NextResponse.json({ success: true, mode: "jwt" });
      response.cookies.set(COOKIE_NAME, sessionId, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        expires: expiresAt,
        path: "/",
      });

      return response;
    }

    if (config.mode === "password" && body.password) {
      if (!config.password) {
        return NextResponse.json(
          { error: "Auth not configured" },
          { status: 500 }
        );
      }

      if (body.password !== config.password) {
        return NextResponse.json(
          { error: "Invalid password" },
          { status: 401 }
        );
      }

      const { sessionId, expiresAt } = createSession();
      cleanupExpiredSessions();

      const response = NextResponse.json({ success: true, mode: "password" });
      response.cookies.set(COOKIE_NAME, sessionId, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        expires: expiresAt,
        path: "/",
      });

      return response;
    }

    return NextResponse.json(
      { error: "Invalid request - provide token or password" },
      { status: 400 }
    );
  } catch (error) {
    console.error("Auth error:", error);
    return NextResponse.json({ error: "Authentication failed" }, { status: 500 });
  }
}

// DELETE /api/auth - Logout
export async function DELETE() {
  try {
    const cookieStore = await cookies();
    const sessionCookie = cookieStore.get(COOKIE_NAME);

    if (sessionCookie) {
      deleteSession(sessionCookie.value);
    }

    const response = NextResponse.json({ success: true });
    response.cookies.delete(COOKIE_NAME);

    return response;
  } catch (error) {
    console.error("Logout error:", error);
    return NextResponse.json({ error: "Logout failed" }, { status: 500 });
  }
}

"use client";

import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";

export default function AuthPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<"jwt" | "password" | "checking">("checking");

  useEffect(() => {
    const token = searchParams.get("token");

    if (token) {
      setMode("jwt");
      handleTokenAuth(token);
    } else {
      checkAuthStatus();
    }
  }, [searchParams]);

  async function checkAuthStatus() {
    try {
      const res = await fetch("/api/auth");
      const data = await res.json();

      if (data.authenticated) {
        router.replace("/");
        return;
      }

      setMode(data.mode === "jwt" ? "jwt" : "password");
    } catch {
      setMode("password");
    }
  }

  async function handleTokenAuth(token: string) {
    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });

      const data = await res.json();

      if (data.success) {
        router.replace("/");
      } else {
        setError(data.error || "Authentication failed");
        setMode("password");
      }
    } catch {
      setError("Authentication failed");
      setMode("password");
    } finally {
      setLoading(false);
    }
  }

  async function handlePasswordSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });

      const data = await res.json();

      if (data.success) {
        router.replace("/");
      } else {
        setError(data.error || "Invalid password");
      }
    } catch {
      setError("Authentication failed");
    } finally {
      setLoading(false);
    }
  }

  if (mode === "checking" || (mode === "jwt" && loading)) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="text-center">
          <div className="mb-4 h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent mx-auto" />
          <p className="text-muted-foreground">Authenticating...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-foreground">AgentOS</h1>
          <p className="mt-2 text-muted-foreground">Enter password to continue</p>
        </div>

        <form onSubmit={handlePasswordSubmit} className="space-y-4">
          <div>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              autoFocus
              disabled={loading}
              className="w-full rounded-lg bg-card px-4 py-3 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>

          {error && (
            <p className="text-sm text-red-500">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading || !password}
            className="w-full rounded-lg bg-primary px-4 py-3 font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {loading ? "Signing in..." : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}

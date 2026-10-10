"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Logo } from "@/components/Logo";
import { safeNextPath } from "@/lib/session-url";

// Where to go once this device can use AgentOS: the page the gate turned
// away (a session's address), or home.
function destination(): string {
  return (
    safeNextPath(new URLSearchParams(window.location.search).get("next")) ?? "/"
  );
}

function guessName(ua: string): string {
  if (/iPad/.test(ua)) return "iPad";
  if (/iPhone/.test(ua)) return "iPhone";
  if (/Android/.test(ua))
    return /Mobile/.test(ua) ? "Android phone" : "Android tablet";
  if (/Macintosh/.test(ua)) return "Mac";
  if (/Windows/.test(ua)) return "Windows PC";
  return "Device";
}

export default function PairPage() {
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signedIn, setSignedIn] = useState(false);

  useEffect(() => {
    // Client-only: the server has no user agent to guess from.
    setName(guessName(navigator.userAgent));
    const fromLink = () => {
      const code = decodeURIComponent(window.location.hash.slice(1));
      if (code) setCode(code);
    };
    fromLink();
    window.addEventListener("hashchange", fromLink);
    fetch("/api/devices").then(
      (r) => setSignedIn(r.ok),
      () => {}
    );
    return () => window.removeEventListener("hashchange", fromLink);
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/pair/claim", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, name }),
    }).catch(() => null);
    if (res?.ok) {
      // Drop the used code from history before leaving.
      window.history.replaceState(null, "", "/pair" + window.location.search);
      window.location.replace(destination());
      return;
    }
    setBusy(false);
    setError(
      res
        ? ((await res.json()).error ?? "Pairing failed.")
        : "Can't reach AgentOS."
    );
  };

  return (
    <main className="bg-background flex min-h-dvh items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center gap-3 text-center">
          <Logo />
          <h1 className="text-xl font-semibold">Pair this device</h1>
          <p className="text-muted-foreground text-sm">
            On a device that already uses AgentOS, open the menu, choose{" "}
            <span className="text-foreground">Devices</span>, then{" "}
            <span className="text-foreground">Add a device</span>.
          </p>
        </div>

        {signedIn ? (
          <div className="bg-muted/40 space-y-3 rounded-lg p-4 text-center">
            <p className="text-sm">This device can already use AgentOS.</p>
            <Button
              className="h-11 w-full"
              onClick={() => window.location.replace(destination())}
            >
              Open AgentOS
            </Button>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-3">
            <Input
              placeholder="XXXX-XXXX-XXXX-XXXX"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              className="h-12 text-center font-mono text-lg tracking-wider"
              aria-label="Pairing code"
            />
            <Input
              placeholder="Name this device"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="h-11"
              aria-label="Device name"
            />
            {error && <p className="text-destructive text-sm">{error}</p>}
            <Button
              type="submit"
              className="h-11 w-full"
              disabled={busy || code.length < 16}
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              Pair
            </Button>
          </form>
        )}
      </div>
    </main>
  );
}

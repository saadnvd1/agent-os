import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { claimCode, probeMachine } from "~/lib/api/pairing";
import { haptic } from "~/lib/haptics";
import { saveMachine, type Machine } from "~/lib/machines/store";
import {
  machineLabel,
  normalizeMachineUrl,
  pairLinkCode,
} from "~/lib/machines/url";

type Step = { kind: "address" } | { kind: "pair"; url: string };

// Adding a machine: probe the address, and pair with a code only when the
// machine asks for one (loopback and the tailnet let us straight in).
// A link (agentos://connect?url=…&code=…) fills both fields and goes.
export function useConnect() {
  const params = useLocalSearchParams<{ url?: string; code?: string }>();
  const [step, setStep] = useState<Step>({ kind: "address" });
  const [address, setAddress] = useState(params.url ?? "");
  const [code, setCode] = useState(params.code ?? "");
  const [name, setName] = useState("iPhone");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const finish = async (
    url: string,
    via: NonNullable<Machine["via"]>,
    token?: string
  ) => {
    await saveMachine({
      id: url,
      name: machineLabel(url),
      url,
      via,
      token,
      addedAt: Date.now(),
    });
    haptic.success();
    router.replace("/sessions");
  };

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      haptic.warn();
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  const submitAddress = (value = address, linkCode?: string) =>
    run(async () => {
      setAddress(value);
      const parsed = normalizeMachineUrl(value);
      if (!parsed.ok) throw new Error(parsed.error);
      const linked = linkCode ?? pairLinkCode(value);
      if (linked) setCode(linked);
      const probe = await probeMachine(parsed.url);
      if (probe.state === "unreachable") throw new Error(probe.error);
      if (probe.state === "trusted") return finish(parsed.url, probe.via);
      setStep({ kind: "pair", url: parsed.url });
    });

  const submitCode = () =>
    run(async () => {
      if (step.kind !== "pair") return;
      const { token } = await claimCode(
        step.url,
        code,
        name.trim() || "iPhone"
      );
      const probe = await probeMachine(step.url, token);
      if (probe.state !== "trusted")
        throw new Error("Paired, but the machine still refuses this phone.");
      await finish(step.url, probe.via, token);
    });

  const linked = useRef<string | null>(null);
  useEffect(() => {
    if (!params.url || linked.current === params.url) return;
    linked.current = params.url;
    submitAddress(params.url, params.code);
    // Each link once, also when it arrives while the screen is open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.url, params.code]);

  return {
    step,
    back: () => setStep({ kind: "address" }),
    address,
    setAddress: (v: string) => {
      setAddress(v);
      setError(null);
    },
    code,
    setCode,
    name,
    setName,
    busy,
    error,
    submitAddress: () => submitAddress(),
    submitCode,
  };
}

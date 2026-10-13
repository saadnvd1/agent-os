import { NextResponse } from "next/server";
import { NotConfigured, sendPhone, type Outcome } from "@/lib/notify";
import { pushAvailable, pushEvent } from "@/lib/notify/push";
import { listPushDevices } from "@/lib/security/devices";

export interface PushTestResult {
  devices: number;
  state: "queued" | "not-set-up" | "failed";
  why?: string;
}

export interface TelegramTestResult {
  state: Outcome["state"] | "not-set-up";
  why?: string;
}

async function testPush(): Promise<PushTestResult> {
  if (!pushAvailable()) return { devices: 0, state: "not-set-up" };
  const devices = listPushDevices().length;
  try {
    // bypass: a button pressed at the Mac is never held by presence, Away or the cap.
    const out = await pushEvent(
      { category: "system", key: `test:${Date.now()}` },
      { bypass: true }
    );
    return out === "queued"
      ? { devices, state: "queued" }
      : { devices: 0, state: "not-set-up" };
  } catch (error) {
    return {
      devices,
      state: "failed",
      why: error instanceof Error ? error.message : String(error),
    };
  }
}

async function testTelegram(): Promise<TelegramTestResult> {
  try {
    const out = await sendPhone("settings-test", "Test from AgentOS");
    return out.state === "failed"
      ? { state: "failed", why: out.why }
      : { state: out.state };
  } catch (error) {
    if (error instanceof NotConfigured) return { state: "not-set-up" };
    return {
      state: "failed",
      why: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function POST() {
  const [push, telegram] = await Promise.all([testPush(), testTelegram()]);
  if (push.state === "not-set-up" && telegram.state === "not-set-up")
    return NextResponse.json(
      {
        error:
          "No phone notifier is set up: pair a phone with push, or set a Telegram bot or AGENTOS_NOTIFY_CMD above",
        push,
        telegram,
      },
      { status: 409 }
    );
  const delivered =
    push.state === "queued" ||
    (telegram.state !== "failed" && telegram.state !== "not-set-up");
  const failure = push.why ?? telegram.why;
  return NextResponse.json(
    { push, telegram, ...(!delivered && failure ? { error: failure } : {}) },
    { status: delivered ? 200 : 502 }
  );
}

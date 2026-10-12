import { NextRequest, NextResponse } from "next/server";
import {
  clearDevicePush,
  getDevicePush,
  setDevicePush,
  setDevicePushCategories,
} from "@/lib/security/devices";
import { callingDevice, needsDevice } from "@/lib/security/device-me";
import { isPushCategory } from "@/lib/notify/copy";
import {
  PUSH_ENVIRONMENTS,
  PUSH_PLATFORMS,
  type PushCategory,
  type PushEnvironment,
  type PushPlatform,
} from "@/lib/notify/push-types";

const bad = (error: string) => NextResponse.json({ error }, { status: 400 });

const body = async (request: NextRequest) =>
  ((await request.json().catch(() => null)) ?? {}) as Record<string, unknown>;

/** Undefined if absent, null if present but invalid. */
function categoriesOf(v: unknown): PushCategory[] | undefined | null {
  if (v === undefined) return undefined;
  if (!Array.isArray(v) || !v.every(isPushCategory)) return null;
  return [...new Set(v)];
}

const view = (id: string) => {
  const p = getDevicePush(id);
  return {
    deviceId: id,
    enabled: !!p,
    categories: p?.categories ?? [],
    environment: p?.environment ?? null,
    platform: p?.platform ?? null,
    lastError: p?.lastError ?? null,
  };
};

// PUT /api/devices/me/push - register or refresh this device's push token
export async function PUT(request: NextRequest) {
  const id = callingDevice(request);
  if (!id) return needsDevice();
  const b = await body(request);
  const token = b.token;
  if (
    typeof token !== "string" ||
    token.length < 8 ||
    token.length > 512 ||
    !/^[A-Za-z0-9:_.\-]+$/.test(token)
  )
    return bad("token must be a device push token");
  const platform = b.platform ?? "ios";
  const environment = b.environment ?? "production";
  if (!PUSH_PLATFORMS.includes(platform as PushPlatform))
    return bad("platform must be ios or android");
  if (!PUSH_ENVIRONMENTS.includes(environment as PushEnvironment))
    return bad("environment must be production or sandbox");
  const categories = categoriesOf(b.categories);
  if (categories === null) return bad("categories must be known names");
  if (
    !setDevicePush(id, {
      token,
      platform: platform as PushPlatform,
      environment: environment as PushEnvironment,
      categories,
    })
  )
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(view(id));
}

// PATCH /api/devices/me/push - choose which categories to receive
export async function PATCH(request: NextRequest) {
  const id = callingDevice(request);
  if (!id) return needsDevice();
  const categories = categoriesOf((await body(request)).categories);
  if (!categories) return bad("categories must be a list of known names");
  if (!setDevicePushCategories(id, categories))
    return NextResponse.json(
      { error: "Push isn't registered" },
      { status: 404 }
    );
  return NextResponse.json(view(id));
}

// DELETE /api/devices/me/push - stop pushing to this device
export async function DELETE(request: NextRequest) {
  const id = callingDevice(request);
  if (!id) return needsDevice();
  clearDevicePush(id);
  return NextResponse.json(view(id));
}

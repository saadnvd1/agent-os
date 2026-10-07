import { NextRequest, NextResponse } from "next/server";
import { notifySettings, setTelegram } from "@/lib/notify";

// The token goes in and never comes back out.
export async function GET() {
  return NextResponse.json({ settings: notifySettings() });
}

export async function PUT(request: NextRequest) {
  try {
    const { telegramToken, telegramChatId } = await request.json();
    setTelegram({ token: telegramToken, chatId: telegramChatId });
    return NextResponse.json({ settings: notifySettings() });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

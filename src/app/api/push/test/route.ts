import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import { sendPushToEmail } from "@/lib/notifications/push";

export async function POST() {
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const result = await sendPushToEmail(user.email, {
      title: "Second Brain",
      body: "Тестовое уведомление работает ✓",
      url: "/",
      tag: "test",
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    console.error("[push/test] error:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Push failed" },
      { status: 500 }
    );
  }
}

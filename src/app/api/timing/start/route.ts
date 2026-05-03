import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api-auth";
import { prepare } from "@/lib/sql";
import { startTimer } from "@/lib/timing-db";
import type { ActiveTimerSnapshot, PomodoroMode } from "@/types";

const VALID_POMODORO: PomodoroMode[] = ["25_5", "50_10"];

export const POST = withAuth(async (req, _ctx, user) => {
  let body: { item_id?: unknown; pomodoro_mode?: unknown; client_request_id?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const itemId = typeof body.item_id === "string" ? body.item_id.trim() : "";
  if (!itemId) {
    return NextResponse.json({ error: "item_id is required" }, { status: 400 });
  }

  let pomodoroMode: PomodoroMode | null = null;
  if (body.pomodoro_mode != null) {
    if (typeof body.pomodoro_mode !== "string"
      || !VALID_POMODORO.includes(body.pomodoro_mode as PomodoroMode)) {
      return NextResponse.json(
        { error: "pomodoro_mode must be '25_5' or '50_10'" },
        { status: 400 },
      );
    }
    pomodoroMode = body.pomodoro_mode as PomodoroMode;
  }

  const clientRequestId =
    typeof body.client_request_id === "string" && body.client_request_id.trim()
      ? body.client_request_id.trim().slice(0, 64)
      : null;

  const item = await prepare<{ id: string; title: string }>(
    "SELECT id, title FROM items WHERE id = ?"
  ).get(itemId);
  if (!item) {
    return NextResponse.json({ error: "item not found" }, { status: 404 });
  }

  const { entry, replaced } = await startTimer({
    userEmail: user.email,
    itemId,
    pomodoroMode,
    clientRequestId,
  });

  let replacedItemTitle: string | null = null;
  if (replaced && replaced.item_id !== entry.item_id) {
    const r = await prepare<{ title: string }>(
      "SELECT title FROM items WHERE id = ?"
    ).get(replaced.item_id);
    replacedItemTitle = r?.title ?? null;
  } else if (replaced) {
    replacedItemTitle = item.title;
  }

  const snapshot: ActiveTimerSnapshot = {
    entry,
    item_title: item.title,
    server_now: new Date().toISOString(),
    replaced_entry: replaced,
    replaced_item_title: replacedItemTitle,
  };
  return NextResponse.json(snapshot, { status: 201 });
});

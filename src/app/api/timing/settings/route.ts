import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api-auth";
import { getTimingSettings, upsertTimingSettings } from "@/lib/timing-db";
import type { PomodoroMode, TimingSettingsInput } from "@/types";

const VALID_POMODORO: PomodoroMode[] = ["25_5", "50_10"];

export const GET = withAuth(async (_req, _ctx, user) => {
  const settings = await getTimingSettings(user.email);
  return NextResponse.json(settings);
});

export const PUT = withAuth(async (req, _ctx, user) => {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const input: TimingSettingsInput = {};

  if (body.idle_threshold_min != null) {
    const n = Number(body.idle_threshold_min);
    if (!Number.isInteger(n) || n < 1 || n > 120) {
      return NextResponse.json({ error: "idle_threshold_min must be 1..120" }, { status: 400 });
    }
    input.idle_threshold_min = n;
  }
  if (body.reminder_interval_min != null) {
    const n = Number(body.reminder_interval_min);
    if (!Number.isInteger(n) || n < 5 || n > 600) {
      return NextResponse.json({ error: "reminder_interval_min must be 5..600" }, { status: 400 });
    }
    input.reminder_interval_min = n;
  }
  if (body.hard_cap_hours != null) {
    const n = Number(body.hard_cap_hours);
    if (!Number.isInteger(n) || n < 1 || n > 24) {
      return NextResponse.json({ error: "hard_cap_hours must be 1..24" }, { status: 400 });
    }
    input.hard_cap_hours = n;
  }
  if (body.default_pomodoro !== undefined) {
    if (body.default_pomodoro === null) {
      input.default_pomodoro = null;
    } else if (
      typeof body.default_pomodoro === "string"
      && VALID_POMODORO.includes(body.default_pomodoro as PomodoroMode)
    ) {
      input.default_pomodoro = body.default_pomodoro as PomodoroMode;
    } else {
      return NextResponse.json({ error: "default_pomodoro must be null | '25_5' | '50_10'" }, { status: 400 });
    }
  }

  const updated = await upsertTimingSettings(user.email, input);
  return NextResponse.json(updated);
});

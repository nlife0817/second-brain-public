import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import {
  getRecurringSeriesById,
  updateRecurringSeriesFollowing,
  deleteRecurringSeriesFollowing,
} from "@/lib/db";
import { UpdateRecurringSeriesPayload } from "@/types";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const series = await getRecurringSeriesById(id);
  if (!series) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(series);
}

// PATCH applies rule + template changes to all FUTURE instances (due_date >= today).
// Past instances are left untouched (per product spec — they are history).
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser();
  if (!user || user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { id } = await params;
  let body: UpdateRecurringSeriesPayload;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body?.rule) return NextResponse.json({ error: "rule is required" }, { status: 400 });

  try {
    const result = await updateRecurringSeriesFollowing(id, body.rule, body.template ?? {});
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to update series";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

// DELETE removes future instances (due_date >= today). If no instances remain,
// the series row itself is dropped. Past instances stay (they are history).
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser();
  if (!user || user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { id } = await params;
  try {
    const result = await deleteRecurringSeriesFollowing(id);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to delete series";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

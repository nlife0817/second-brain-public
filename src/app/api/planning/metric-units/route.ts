import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/api-auth";
import { listMetricUnits } from "@/lib/db";
import { prepare } from "@/lib/sql";

export const GET = withAuth(async () => {
  return NextResponse.json(await listMetricUnits());
});

export const POST = withAuth(async (req: NextRequest) => {
  const body = await req.json().catch(() => null) as { code?: string; title?: string; is_default?: boolean } | null;
  if (!body?.code?.trim() || !body?.title?.trim()) {
    return NextResponse.json({ error: "code and title required" }, { status: 400 });
  }
  await prepare(`
    INSERT INTO planning_metric_units (code, title, is_default)
    VALUES (?, ?, ?)
    ON CONFLICT (code) DO UPDATE SET title = EXCLUDED.title, is_default = EXCLUDED.is_default
  `).run(body.code.trim(), body.title.trim(), body.is_default ?? false);
  const row = await prepare(
    "SELECT * FROM planning_metric_units WHERE code = ?"
  ).get(body.code.trim());
  return NextResponse.json(row, { status: 201 });
});

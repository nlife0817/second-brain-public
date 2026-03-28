import { NextRequest, NextResponse } from "next/server";
import { getAllWeeklyPlans, createWeeklyPlan, getTransferableEntries, bulkAddItemsToPlan } from "@/lib/db";
import { v4 as uuid } from "uuid";

export async function GET() {
  const plans = getAllWeeklyPlans();
  return NextResponse.json(plans);
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    if (!body.week_start || !body.week_end) {
      return NextResponse.json({ error: "week_start and week_end are required" }, { status: 400 });
    }

    const plan = createWeeklyPlan({
      id: uuid(),
      week_start: body.week_start,
      week_end: body.week_end,
      title: body.title ?? "",
    });

    // Transfer entries from previous plan if requested
    if (body.transferFromPlanId && body.transferEntryIds?.length) {
      const transferable = getTransferableEntries(body.transferFromPlanId);
      const validIds = transferable.map((e) => e.item_id);
      const toTransfer = (body.transferEntryIds as string[]).filter((id: string) => validIds.includes(id));
      if (toTransfer.length) {
        bulkAddItemsToPlan(plan.id, toTransfer);
      }
    }

    return NextResponse.json(plan, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
}

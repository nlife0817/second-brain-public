import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/api-auth";
import { getItemById, updateItem, createInitiative, linkInitiativeToMetric } from "@/lib/db";
import { logChange } from "@/lib/planning-changelog";

/**
 * POST /api/planning/initiatives/[id]/promote-from-task
 * Body: { task_id, type, due_period_id?, linked_metric_ids? }
 *
 * Note: `id` in URL is a placeholder — the new initiative gets a fresh UUID.
 * The route lives under `initiatives/[id]` for symmetry; the [id] is ignored
 * and only kept for routing convenience.
 */
export const POST = withAuth(async (req: NextRequest, _ctx, user) => {
  const body = await req.json();
  const taskId = body?.task_id;
  if (!taskId) return NextResponse.json({ error: "task_id required" }, { status: 400 });

  const task = await getItemById(taskId);
  if (!task) return NextResponse.json({ error: "task not found" }, { status: 404 });

  const initiative = await createInitiative({
    title: task.title,
    type: body.type ?? "product_maturity",
    description: task.description ?? null,
    due_period_id: body.due_period_id ?? null,
    estimate_hours: task.estimated_minutes ? task.estimated_minutes / 60 : null,
    created_from_task_id: task.id,
    direction_id: body.direction_id ?? null,
  });

  if (Array.isArray(body.linked_metric_ids)) {
    for (const mid of body.linked_metric_ids) await linkInitiativeToMetric(initiative.id, mid);
  }

  // Bind the task to the new initiative
  await updateItem(task.id, { initiative_id: initiative.id } as Parameters<typeof updateItem>[1]);

  await logChange({
    actor_email: user.email,
    entity_type: "initiative",
    entity_id: initiative.id,
    action: "promote_from_task",
    diff: { from_task_id: { from: null, to: task.id } },
  });

  return NextResponse.json(initiative, { status: 201 });
});

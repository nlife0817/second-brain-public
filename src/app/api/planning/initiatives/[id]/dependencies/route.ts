import { NextResponse } from "next/server";

// P6: «Зависимости инициатив» удалены (PLAN_PLANNING_REWORK §0).
// Таблица planning_initiative_dependency дропнута миграцией 0032.
// Endpoints оставлены как 410 Gone для обратной совместимости со старыми
// клиентами; ничего не делают.

export async function GET() {
  return NextResponse.json([], { status: 200 });
}

export async function POST() {
  return NextResponse.json({ error: "Dependencies removed in P6" }, { status: 410 });
}

export async function DELETE() {
  return NextResponse.json({ error: "Dependencies removed in P6" }, { status: 410 });
}

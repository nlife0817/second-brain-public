import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api-auth";
import { listBlockedClients } from "@/lib/db";

// GET /api/planning/blocked-clients
// P8: заменяет /api/planning/blocked-deals. Возвращает клиентов (опц. конкретные
// сделки), которых блокируют незакрытые инициативы.
export const GET = withAuth(async () => {
  const rows = await listBlockedClients();
  return NextResponse.json(rows);
});

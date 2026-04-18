import { NextRequest, NextResponse } from "next/server";
import { getAllCrmSystems, createCrmSystem } from "@/lib/db";
import { getAuthUser } from "@/lib/auth";

export async function GET() {
  return NextResponse.json(await getAllCrmSystems());
}

export async function POST(req: NextRequest) {
  const user = await getAuthUser();
  if (!user || user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  try {
    const body = await req.json();
    const { name } = body;
    if (!name) return NextResponse.json({ error: "Name required" }, { status: 400 });

    const crm = await createCrmSystem({
      id: crypto.randomUUID(),
      name,
    });
    return NextResponse.json(crm, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Failed to create CRM system" }, { status: 500 });
  }
}

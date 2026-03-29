import { NextRequest, NextResponse } from "next/server";
import { getAllCrmSystems, createCrmSystem } from "@/lib/db";

export async function GET() {
  return NextResponse.json(getAllCrmSystems());
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { name } = body;
    if (!name) return NextResponse.json({ error: "Name required" }, { status: 400 });

    const crm = createCrmSystem({
      id: crypto.randomUUID(),
      name,
    });
    return NextResponse.json(crm, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Failed to create CRM system" }, { status: 500 });
  }
}

import { NextResponse } from "next/server";
import { getAllRelationTypes, createRelationType } from "@/lib/db";

export async function GET() {
  return NextResponse.json(getAllRelationTypes());
}

export async function POST(req: Request) {
  const body = await req.json();
  const { name, color, icon, is_system } = body;
  if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });

  const rt = createRelationType({
    id: crypto.randomUUID(),
    name,
    color: color ?? "#6b7280",
    icon: icon ?? "Link",
    is_system: is_system ?? 0,
  });
  return NextResponse.json(rt, { status: 201 });
}

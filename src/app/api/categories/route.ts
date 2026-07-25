import { NextRequest, NextResponse } from "next/server";
import { getAllCategories, createCategory } from "@/lib/db";
import { getAuthUser } from "@/lib/auth";

export async function GET() {
  return NextResponse.json(await getAllCategories());
}

export async function POST(req: NextRequest) {
  const user = await getAuthUser();
  if (!user || user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  try {
    const body = await req.json();
    const { name, color, icon } = body;
    if (!name) return NextResponse.json({ error: "Name required" }, { status: 400 });

    const category = await createCategory({
      id: crypto.randomUUID(),
      name,
      color: color || "#6b7280",
      icon: icon || "Folder",
    });
    return NextResponse.json(category, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Failed to create category" }, { status: 500 });
  }
}

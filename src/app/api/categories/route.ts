import { NextRequest, NextResponse } from "next/server";
import { getAllCategories, createCategory } from "@/lib/db";

export async function GET() {
  return NextResponse.json(getAllCategories());
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { name, color, icon } = body;
    if (!name) return NextResponse.json({ error: "Name required" }, { status: 400 });

    const category = createCategory({
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

import { NextRequest, NextResponse } from "next/server";
import { getAllTags, createTag } from "@/lib/db";
import { v4 as uuid } from "uuid";

export async function GET() {
  return NextResponse.json(getAllTags());
}

export async function POST(req: NextRequest) {
  const body = await req.json();

  if (!body.name?.trim()) {
    return NextResponse.json({ error: "Name is required" }, { status: 400 });
  }

  const tag = createTag({
    id: uuid(),
    name: body.name.trim(),
    color: body.color ?? "#6b7280",
  });

  return NextResponse.json(tag, { status: 201 });
}

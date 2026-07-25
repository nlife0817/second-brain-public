import { NextRequest, NextResponse } from "next/server";
import { getAllItemStatuses, createItemStatus } from "@/lib/db";
import { getAuthUser } from "@/lib/auth";

export async function GET() {
  return NextResponse.json(await getAllItemStatuses());
}

export async function POST(req: NextRequest) {
  const user = await getAuthUser();
  if (!user || user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  try {
    const body = await req.json();
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) {
      return NextResponse.json({ error: "Name required" }, { status: 400 });
    }
    const color = typeof body.color === "string" ? body.color : undefined;
    const kind =
      body.kind === "done" || body.kind === "archived" ? body.kind : "open";
    // Slug-style ID derived from the name; falls back to a uuid if the slug
    // collides or is empty (non-Latin names).
    const slug = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");
    const id = slug.length > 0 ? `${slug}_${crypto.randomUUID().slice(0, 8)}` : crypto.randomUUID();
    const status = await createItemStatus({ id, name, color, kind });
    return NextResponse.json(status, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Failed to create" }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { getAllClientsFull, createClient, syncClientNested, reorderClients } from "@/lib/db";
import { CreateClientPayload } from "@/types";
import { getAuthUser } from "@/lib/auth";

export async function GET() {
  return NextResponse.json(getAllClientsFull());
}

export async function POST(req: NextRequest) {
  const user = getAuthUser(req.headers);
  if (!user || user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  try {
    const body: CreateClientPayload = await req.json();
    if (!body.name?.trim()) return NextResponse.json({ error: "Name required" }, { status: 400 });

    const id = crypto.randomUUID();
    const client = createClient({ id, name: body.name.trim(), status_id: body.status_id });

    syncClientNested(id, {
      companies: body.companies,
      contacts: body.contacts,
      notes: body.notes,
      links: body.links,
    });

    return NextResponse.json(client, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Failed to create client" }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  const user = getAuthUser(req.headers);
  if (!user || user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  try {
    const body = await req.json();
    if (body.clients && Array.isArray(body.clients)) {
      reorderClients(body.clients);
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  } catch {
    return NextResponse.json({ error: "Failed to reorder" }, { status: 500 });
  }
}

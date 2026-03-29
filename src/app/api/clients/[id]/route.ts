import { NextRequest, NextResponse } from "next/server";
import { getClientFull, updateClient, deleteClient, syncClientNested } from "@/lib/db";
import { UpdateClientPayload } from "@/types";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const client = getClientFull(id);
  if (!client) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(client);
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const body: UpdateClientPayload = await req.json();

    const { companies, contacts, notes, links, ...clientUpdates } = body;
    if (Object.keys(clientUpdates).length > 0) {
      const updated = updateClient(id, clientUpdates);
      if (!updated) return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    syncClientNested(id, { companies, contacts, notes, links });

    const full = getClientFull(id);
    return NextResponse.json(full);
  } catch {
    return NextResponse.json({ error: "Failed to update" }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ok = deleteClient(id);
  if (!ok) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}

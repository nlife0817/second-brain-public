import { NextRequest, NextResponse } from "next/server";
import { getClientFull, updateClient, deleteClient, syncClientNested, setClientCrmSystems } from "@/lib/db";
import { UpdateClientPayload } from "@/types";
import { getAuthUser } from "@/lib/auth";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const client = getClientFull(id);
  if (!client) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(client);
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getAuthUser(req.headers);
  if (!user || user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { id } = await params;
  try {
    const body: UpdateClientPayload = await req.json();

    const { companies, contacts, notes, links, crm_system_ids, ...clientUpdates } = body;
    if (Object.keys(clientUpdates).length > 0) {
      const updated = updateClient(id, clientUpdates);
      if (!updated) return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    if (crm_system_ids) {
      setClientCrmSystems(id, crm_system_ids);
    }

    syncClientNested(id, { companies, contacts, notes, links });

    const full = getClientFull(id);
    return NextResponse.json(full);
  } catch {
    return NextResponse.json({ error: "Failed to update" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getAuthUser(req.headers);
  if (!user || user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { id } = await params;
  const ok = deleteClient(id);
  if (!ok) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}

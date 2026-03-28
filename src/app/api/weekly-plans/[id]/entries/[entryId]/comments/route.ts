import { NextRequest, NextResponse } from "next/server";
import { addEntryComment, getEntryComments, deleteEntryComment } from "@/lib/db";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string; entryId: string }> }) {
  const { entryId } = await params;
  const comments = getEntryComments(entryId);
  return NextResponse.json(comments);
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string; entryId: string }> }) {
  try {
    const { entryId } = await params;
    const body = await req.json();

    if (!body.text?.trim()) {
      return NextResponse.json({ error: "text is required" }, { status: 400 });
    }

    const comment = addEntryComment(entryId, body.text.trim());
    return NextResponse.json(comment, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const body = await req.json();
    if (!body.commentId) {
      return NextResponse.json({ error: "commentId is required" }, { status: 400 });
    }
    const deleted = deleteEntryComment(body.commentId);
    if (!deleted) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
}

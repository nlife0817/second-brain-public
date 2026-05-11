import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/api-auth";
import { listInitiatives } from "@/lib/db";

// Concept §6.7.3.A. Keyword-based initiative suggestion for a free-form task title/description.

const STOP_WORDS = new Set([
  "и","в","на","с","по","для","из","от","до","за","к","о","об","или","а","но","что","как","это","этот","тех","того",
  "the","a","an","of","to","in","on","and","or","but","is","are","be","with","for","by",
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !STOP_WORDS.has(t));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersect = 0;
  for (const t of a) if (b.has(t)) intersect += 1;
  return intersect / (a.size + b.size - intersect);
}

export const POST = withAuth(async (req: NextRequest) => {
  const body = await req.json().catch(() => null) as { title?: string; description?: string } | null;
  if (!body?.title) return NextResponse.json({ error: "title required" }, { status: 400 });

  const taskTokens = new Set([...tokenize(body.title), ...tokenize(body.description ?? "")]);
  if (taskTokens.size === 0) return NextResponse.json({ suggestions: [] });

  const inits = await listInitiatives({ includeArchivedAfterDays: 30 });
  const scored = inits
    .filter((i) => i.status !== "done" && i.status !== "killed")
    .map((i) => {
      const initTokens = new Set([...tokenize(i.title), ...tokenize(i.description ?? "")]);
      const score = jaccard(taskTokens, initTokens);
      return { id: i.id, title: i.title, type: i.type, score };
    })
    .filter((s) => s.score >= 0.15)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);

  return NextResponse.json({ suggestions: scored });
});

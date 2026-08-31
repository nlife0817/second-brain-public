import { notFound } from "next/navigation";
import { getActiveOrgAuth } from "@/lib/core/bootstrap";
import { isUuid } from "@/lib/core/http";
import { getKbDocument } from "@/lib/core/kb";
import { KbDocumentClient } from "./KbDocumentClient";

export default async function KbDocumentPage({
  params,
}: {
  params: Promise<{ docId: string }>;
}) {
  const { docId } = await params;
  const auth = await getActiveOrgAuth();
  if (!auth) return null;
  if (!isUuid(docId)) notFound();

  // Недоступный документ неотличим от несуществующего — сервис отвечает 404, и
  // маршрут обязан превратить его в страницу, а не в ошибку рендера.
  const document = await getKbDocument(auth, docId).catch(() => null);
  if (!document) notFound();

  return <KbDocumentClient initial={document} />;
}

import { getActiveOrgAuth } from "@/lib/core/bootstrap";
import { listKbTrash } from "@/lib/core/kb";
import { KbTrashClient } from "./KbTrashClient";

export default async function KbTrashPage() {
  const auth = await getActiveOrgAuth();
  if (!auth) return null;
  return <KbTrashClient initial={await listKbTrash(auth)} />;
}

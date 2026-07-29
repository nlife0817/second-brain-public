import { getActiveOrgAuth } from "@/lib/core/bootstrap";
import { listRules } from "@/lib/core/recurring";
import { RecurringClient } from "./RecurringClient";

export default async function RecurringPage() {
  const auth = await getActiveOrgAuth();
  if (!auth) return null;
  return <RecurringClient initial={await listRules(auth)} />;
}

import { getActiveOrgAuth } from "@/lib/core/bootstrap";
import { listMyTasks } from "@/lib/core/tasks";
import { MobileMyTasksClient } from "./MobileMyTasksClient";

export default async function MobileMyTasksPage() {
  const auth = await getActiveOrgAuth();
  if (!auth) return null;
  return <MobileMyTasksClient initial={await listMyTasks(auth, { includeDone: false })} />;
}

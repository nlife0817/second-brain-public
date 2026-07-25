import { getActiveOrgAuth } from "@/lib/core/bootstrap";
import { listClientStatuses, listClients, listCrmSystems } from "@/lib/core/clients";
import { ClientsClient } from "./ClientsClient";

export default async function ClientsPage() {
  const auth = await getActiveOrgAuth();
  if (!auth) return null;
  const [clients, statuses, crm_systems] = await Promise.all([
    listClients(auth),
    listClientStatuses(auth),
    listCrmSystems(auth),
  ]);
  return <ClientsClient initial={{ clients, meta: { statuses, crm_systems } }} />;
}

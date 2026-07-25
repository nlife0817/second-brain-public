import { getActiveOrgAuth } from "@/lib/core/bootstrap";
import { listClientStatuses, listClients, listCrmSystems } from "@/lib/core/clients";
import { canOrg } from "@/lib/core/policy";
import { ClientsClient } from "./ClientsClient";

export default async function ClientsPage() {
  const auth = await getActiveOrgAuth();
  if (!auth) return null;

  // Гостю CRM не видна: без этой проверки выборки бросили бы PolicyError и
  // экран ответил бы ошибкой рендера вместо внятного отказа.
  if (!canOrg(auth, "clients.view")) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground">
        Раздел «Клиенты» доступен сотрудникам организации
      </div>
    );
  }

  const [clients, statuses, crm_systems] = await Promise.all([
    listClients(auth),
    listClientStatuses(auth),
    listCrmSystems(auth),
  ]);
  return <ClientsClient initial={{ clients, meta: { statuses, crm_systems } }} />;
}

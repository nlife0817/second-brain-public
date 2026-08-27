import { getActiveOrgAuth } from "@/lib/core/bootstrap";
import { listClients } from "@/lib/core/clients";
import { canOrg } from "@/lib/core/policy";
import { ClientsClient } from "./ClientsClient";

export default async function ClientsPage() {
  const auth = await getActiveOrgAuth();
  if (!auth) return null;

  // Гостю CRM не видна: без этой проверки выборки бросили бы PolicyError и
  // экран ответил бы ошибкой рендера вместо внятного отказа.
  if (!canOrg(auth, "crm.view")) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground">
        Раздел «Клиенты» доступен сотрудникам организации
      </div>
    );
  }

  return <ClientsClient initial={{ clients: await listClients(auth) }} />;
}

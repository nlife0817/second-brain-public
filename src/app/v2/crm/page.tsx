import { getActiveOrgAuth } from "@/lib/core/bootstrap";
import { listCrmMeta, listDeals } from "@/lib/core/crm";
import { canOrg } from "@/lib/core/policy";
import { CrmClient } from "./CrmClient";

export default async function CrmPage() {
  const auth = await getActiveOrgAuth();
  if (!auth) return null;

  // Отказ по правам решается до выборок: иначе сервис бросит PolicyError и
  // маршрут ответит ошибкой рендера вместо внятного объяснения.
  if (!canOrg(auth, "crm.view")) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground">
        Раздел CRM доступен сотрудникам организации
      </div>
    );
  }

  const meta = await listCrmMeta(auth);
  const pipeline = meta.pipelines.find((p) => p.is_default) ?? meta.pipelines[0] ?? null;
  const deals = pipeline ? await listDeals(auth, { pipelineId: pipeline.id }) : [];

  return (
    <CrmClient
      initial={{ meta, deals, pipelineId: pipeline?.id ?? null }}
      canConfigure={canOrg(auth, "crm.configure")}
      canManage={canOrg(auth, "crm.manage")}
    />
  );
}

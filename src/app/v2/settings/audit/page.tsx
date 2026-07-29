// Полный журнал действий организации — то, что открывает кнопка «Посмотреть
// все» в настройках. Записи считаются на сервере одним проходом; предел тот же,
// что и у выборки журнала (AUDIT_MAX_LIMIT).

import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { getActiveOrgAuth } from "@/lib/core/bootstrap";
import { readSectionsConfig, visibleSections } from "@/lib/core/settings-sections";
import { AUDIT_MAX_LIMIT, listOrgAudit } from "@/lib/core/saas";
import { getOrganization } from "@/lib/core/identity";
import { AuditList } from "@/components/v2/AuditList";

export default async function AuditPage() {
  const auth = await getActiveOrgAuth();
  if (!auth) return null;

  const org = await getOrganization(auth.orgId);
  const sections = visibleSections(auth.orgRole, readSectionsConfig(org?.settings));
  // Раздел закрыт настройкой — экран не должен становиться обходным путём.
  if (!sections.includes("audit")) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Раздел недоступен
      </div>
    );
  }

  const events = await listOrgAudit(auth, { limit: AUDIT_MAX_LIMIT });

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-2 border-b border-border px-6 py-3.5">
        <Link
          href="/v2/settings"
          className="rounded-lg p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          title="К настройкам"
        >
          <ChevronLeft className="size-4" />
        </Link>
        <h1 className="text-base font-semibold">Журнал действий</h1>
        <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-muted-foreground">
          {events.length}
        </span>
      </header>
      <div className="flex-1 overflow-y-auto px-6 py-4">
        <div className="mx-auto max-w-3xl">
          <AuditList events={events} />
          {events.length === AUDIT_MAX_LIMIT && (
            <p className="mt-3 text-xs text-muted-foreground">
              Показаны последние {AUDIT_MAX_LIMIT} действий.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

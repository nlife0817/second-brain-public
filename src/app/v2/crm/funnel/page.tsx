import Link from "next/link";
import { getActiveOrgAuth } from "@/lib/core/bootstrap";
import { listCrmMeta, stageEntries } from "@/lib/core/crm";
import { buildFunnel, visibleStages } from "@/lib/core/crm-model";
import { canOrg } from "@/lib/core/policy";
import { CrmTabs } from "../CrmTabs";

const PERIODS = [
  { days: 30, label: "30 дней" },
  { days: 90, label: "90 дней" },
  { days: 365, label: "год" },
  { days: 0, label: "всё время" },
];

export default async function FunnelPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string; pipeline?: string }>;
}) {
  const auth = await getActiveOrgAuth();
  if (!auth) return null;
  if (!canOrg(auth, "crm.view")) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground">
        Раздел CRM доступен сотрудникам организации
      </div>
    );
  }

  const params = await searchParams;
  const days = Number(params.days ?? 30);
  const meta = await listCrmMeta(auth);
  const pipeline =
    meta.pipelines.find((p) => p.id === params.pipeline) ??
    meta.pipelines.find((p) => p.is_default) ??
    meta.pipelines[0];

  if (!pipeline) {
    return (
      <div className="flex h-full flex-col">
        <CrmTabs active="funnel" />
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          Воронок пока нет
        </div>
      </div>
    );
  }

  // Период считается от «сейчас», и считает его Postgres (см. stageEntries):
  // воронка отвечает «сколько дошло за последние N дней», а не «где сделки лежат
  // сегодня».
  const entered = await stageEntries(auth, { pipelineId: pipeline.id, days: days > 0 ? days : null });
  const steps = buildFunnel(visibleStages(meta.stages, pipeline.id), entered);
  const first = steps[0]?.entered ?? 0;

  return (
    <div className="flex h-full flex-col">
      <CrmTabs active="funnel" />

      <div className="flex items-center gap-2 border-b px-4 py-2">
        {meta.pipelines.map((p) => (
          <Link
            key={p.id}
            href={`/v2/crm/funnel?pipeline=${p.id}&days=${days}`}
            className={`rounded-lg px-2.5 py-1 text-sm ${
              p.id === pipeline.id ? "bg-muted font-medium" : "text-muted-foreground hover:bg-muted/60"
            }`}
          >
            {p.name}
          </Link>
        ))}
        <span className="flex-1" />
        {PERIODS.map((p) => (
          <Link
            key={p.days}
            href={`/v2/crm/funnel?pipeline=${pipeline.id}&days=${p.days}`}
            className={`rounded-lg px-2 py-1 text-xs ${
              p.days === days ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted"
            }`}
          >
            {p.label}
          </Link>
        ))}
      </div>

      <div className="max-w-3xl overflow-y-auto p-6">
        <h2 className="text-sm font-semibold">Воронка · {pipeline.name}</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Считается по истории этапов: сколько сделок <b>входило</b> в этап за период. Снимок доски
          ответил бы «где они сейчас» — сделка, прошедшая этап за час, в нём не видна вовсе.
        </p>

        <div className="mt-5 flex flex-col gap-1">
          {steps.map((s, i) => (
            <div key={s.stage_id}>
              {i > 0 && (
                <div className="grid grid-cols-[140px_1fr] gap-3 py-0.5">
                  <span />
                  <span className="font-mono text-[11px] text-muted-foreground">
                    {s.conversion === null ? "→ —" : `→ ${s.conversion}%`}
                  </span>
                </div>
              )}
              <div className="grid grid-cols-[140px_1fr_120px] items-center gap-3">
                <span className="truncate text-right text-sm font-medium">{s.name}</span>
                <div
                  className={`h-6 rounded-md ${s.kind === "won" ? "bg-emerald-500" : "bg-primary"}`}
                  style={{ width: `${Math.max(s.share, first > 0 ? 1 : 0)}%`, minWidth: s.entered > 0 ? 4 : 0 }}
                />
                <span className="font-mono text-xs text-muted-foreground">
                  {s.entered} · {s.share}%
                </span>
              </div>
            </div>
          ))}
        </div>

        {first === 0 && (
          <p className="mt-6 text-sm text-muted-foreground">
            За этот период сделки в воронку не заходили.
          </p>
        )}
      </div>
    </div>
  );
}

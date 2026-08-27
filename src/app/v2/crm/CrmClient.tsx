"use client";

// Экран CRM: доска сделок по этапам воронки, карточка сделки и редактор этапов.
//
// Доска устроена как доска проекта (ProjectBoard): те же dnd-kit, тот же предел
// отрисовки колонки и тот же оптимистичный перенос с откатом. Отличие одно и
// содержательное: перенос карточки здесь пишет строку в историю этапов — из неё
// потом считается вся аналитика воронки, поэтому «просто поменять stage_id»
// мимо сервера нельзя.

import { memo, useCallback, useMemo, useState } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { Plus, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SidePanel } from "@/components/v2/SidePanel";
import { api } from "@/lib/core/client";
import { invalidate } from "@/lib/core/query";
import { daysOnStage, STUCK_DAYS, visibleStages } from "@/lib/core/crm-model";
import type { CrmMeta, DealHistoryEntry, DealRow, PipelineStage } from "@/lib/core/crm";
import { useV2Store } from "@/lib/core/ui-store";
import { CrmTabs } from "./CrmTabs";
import { DealPanel } from "./DealPanel";
import { PipelineDialog } from "./PipelineDialog";

/** Сколько карточек рисует колонка сразу — тот же предел, что у доски задач. */
const COLUMN_PAGE = 50;

export interface CrmInitial {
  meta: CrmMeta;
  deals: DealRow[];
  pipelineId: string | null;
}

export function formatAmount(value: number | null): string {
  if (value === null) return "";
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(value) + " ₽";
}

function DealCard({ deal, onOpen }: { deal: DealRow; onOpen: (id: string) => void }) {
  const days = deal.stage_entered_at ? daysOnStage(deal.stage_entered_at, new Date()) : 0;
  const contact = deal.client_name || deal.contact_name || deal.contact_phone;
  return (
    <button
      onClick={() => onOpen(deal.id)}
      className="w-full rounded-xl border border-border bg-background p-2.5 text-left shadow-sm transition hover:border-foreground/20 hover:shadow"
    >
      <div className="text-sm font-medium leading-snug">{deal.title || "Без названия"}</div>
      {contact && <div className="mt-0.5 text-xs text-muted-foreground">{contact}</div>}
      {deal.amount !== null && (
        <div className="mt-1 font-mono text-xs font-semibold">{formatAmount(deal.amount)}</div>
      )}
      <div className="mt-2 flex items-center gap-2 text-[11px] text-muted-foreground">
        {deal.source_name && (
          <span
            className="rounded-full px-1.5 py-0.5"
            style={{
              backgroundColor: `${deal.source_color ?? "#6b7280"}1f`,
              color: deal.source_color ?? undefined,
            }}
          >
            {deal.source_name}
          </span>
        )}
        <span className="flex-1" />
        {/* Застой виден на доске, а не только в отчёте: метка желтеет после порога. */}
        {deal.stage_entered_at && !deal.closed_at && (
          <span className={days >= STUCK_DAYS ? "font-semibold text-amber-600" : ""}>
            {days === 0 ? "сегодня" : `${days} дн`}
          </span>
        )}
      </div>
    </button>
  );
}

const DraggableDeal = memo(function DraggableDeal({
  deal,
  disabled,
  onOpen,
}: {
  deal: DealRow;
  disabled: boolean;
  onOpen: (id: string) => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: deal.id, disabled });
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={isDragging ? "opacity-40" : undefined}
    >
      <DealCard deal={deal} onOpen={onOpen} />
    </div>
  );
});

function Column({
  stage,
  deals,
  showAmounts,
  canManage,
  onOpen,
  onAdd,
}: {
  stage: PipelineStage;
  deals: DealRow[];
  showAmounts: boolean;
  canManage: boolean;
  onOpen: (id: string) => void;
  onAdd: (stageId: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `stage:${stage.id}` });
  const [limit, setLimit] = useState(COLUMN_PAGE);
  const shown = deals.length > limit ? deals.slice(0, limit) : deals;
  const rest = deals.length - shown.length;
  // Сумма колонки — состояние воронки видно без отчёта.
  const total = deals.reduce((acc, d) => acc + (d.amount ?? 0), 0);

  return (
    <div className="flex w-72 shrink-0 flex-col rounded-xl bg-muted/40">
      <div className="flex items-center gap-2 px-3 pb-1 pt-2.5">
        <span className="size-2 rounded-full" style={{ backgroundColor: stage.color }} />
        <span className="text-sm font-medium">{stage.name}</span>
        <span className="text-xs text-muted-foreground">{deals.length}</span>
        <span className="flex-1" />
        {showAmounts && total > 0 && (
          <span className="font-mono text-[11px] text-muted-foreground">{formatAmount(total)}</span>
        )}
        {canManage && stage.kind === "open" && (
          <button
            onClick={() => onAdd(stage.id)}
            title="Новая сделка"
            className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <Plus className="size-3.5" />
          </button>
        )}
      </div>
      <div
        ref={setNodeRef}
        className={`flex min-h-24 flex-1 flex-col gap-1.5 overflow-y-auto p-2 transition-colors ${isOver ? "bg-muted/70" : ""}`}
      >
        {shown.map((d) => (
          <DraggableDeal key={d.id} deal={d} disabled={!canManage} onOpen={onOpen} />
        ))}
        {rest > 0 && (
          <button
            onClick={() => setLimit((l) => l + COLUMN_PAGE)}
            className="rounded-lg border border-dashed border-border py-1.5 text-xs text-muted-foreground hover:bg-muted/60 hover:text-foreground"
          >
            Показать ещё {Math.min(COLUMN_PAGE, rest)} · осталось {rest}
          </button>
        )}
      </div>
    </div>
  );
}

export function CrmClient({
  initial,
  canConfigure,
  canManage,
}: {
  initial: CrmInitial;
  canConfigure: boolean;
  canManage: boolean;
}) {
  const { orgId } = useV2Store();
  const [meta, setMeta] = useState<CrmMeta>(initial.meta);
  const [deals, setDeals] = useState<DealRow[]>(initial.deals);
  const [pipelineId, setPipelineId] = useState<string | null>(initial.pipelineId);
  const [openDeal, setOpenDeal] = useState<{ deal: DealRow; history: DealHistoryEntry[] } | null>(null);
  const [dragDeal, setDragDeal] = useState<DealRow | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const pipeline = meta.pipelines.find((p) => p.id === pipelineId) ?? null;
  const stages = useMemo(
    () => visibleStages(meta.stages, pipelineId),
    [meta.stages, pipelineId],
  );

  const byStage = useMemo(() => {
    const map = new Map<string, DealRow[]>();
    for (const d of deals) {
      const bucket = map.get(d.stage_id);
      if (bucket) bucket.push(d);
      else map.set(d.stage_id, [d]);
    }
    return map;
  }, [deals]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const switchPipeline = useCallback(
    async (id: string) => {
      if (!orgId) return;
      setPipelineId(id);
      setBusy(true);
      try {
        setDeals(await api.get<DealRow[]>(`/orgs/${orgId}/crm/deals?pipeline_id=${id}`));
      } finally {
        setBusy(false);
      }
    },
    [orgId],
  );

  const reloadDeals = useCallback(async () => {
    if (!orgId || !pipelineId) return;
    setDeals(await api.get<DealRow[]>(`/orgs/${orgId}/crm/deals?pipeline_id=${pipelineId}`));
    invalidate(`/orgs/${orgId}/crm`);
  }, [orgId, pipelineId]);

  const openCard = useCallback(
    async (id: string) => {
      if (!orgId) return;
      const bundle = await api.get<{ deal: DealRow; history: DealHistoryEntry[] }>(
        `/orgs/${orgId}/crm/deals/${id}`,
      );
      setOpenDeal(bundle);
    },
    [orgId],
  );

  const addDeal = useCallback(
    async (stageId: string) => {
      if (!orgId || !pipelineId) return;
      const created = await api.post<DealRow>(`/orgs/${orgId}/crm/deals`, {
        pipeline_id: pipelineId,
        stage_id: stageId,
        title: "Новая сделка",
      });
      setDeals((cur) => [...cur, created]);
      void openCard(created.id);
    },
    [orgId, pipelineId, openCard],
  );

  function onDragStart(e: DragStartEvent) {
    setDragDeal(deals.find((d) => d.id === e.active.id) ?? null);
  }

  async function onDragEnd(e: DragEndEvent) {
    setDragDeal(null);
    const overId = e.over?.id;
    if (!orgId || typeof overId !== "string" || !overId.startsWith("stage:")) return;
    const stageId = overId.slice("stage:".length);
    const dealId = String(e.active.id);
    const deal = deals.find((d) => d.id === dealId);
    if (!deal || deal.stage_id === stageId) return;

    // Оптимистично двигаем карточку, но откат обязателен: без него интерфейс
    // соврёт после первой же ошибки сети.
    const prev = deals;
    setDeals((cur) => [...cur.filter((d) => d.id !== dealId), { ...deal, stage_id: stageId }]);
    try {
      const updated = await api.patch<DealRow>(`/orgs/${orgId}/crm/deals/${dealId}`, {
        stage_id: stageId,
      });
      setDeals((cur) => cur.map((d) => (d.id === dealId ? updated : d)));
      invalidate(`/orgs/${orgId}/crm`);
    } catch {
      setDeals(prev);
    }
  }

  const onDealChanged = useCallback((next: DealRow | null, id: string) => {
    setDeals((cur) => (next ? cur.map((d) => (d.id === id ? next : d)) : cur.filter((d) => d.id !== id)));
    if (!next) setOpenDeal(null);
    else setOpenDeal((cur) => (cur ? { ...cur, deal: next } : cur));
  }, []);

  if (!pipeline) {
    return (
      <div className="flex h-full flex-col">
        <CrmTabs active="board" />
        <div className="flex flex-1 items-center justify-center px-6 text-center text-sm text-muted-foreground">
          В организации нет ни одной воронки.
          {canConfigure && " Создайте первую — она появится с готовыми этапами."}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <CrmTabs active="board" />

      <div className="flex items-center gap-2 border-b px-4 py-2">
        <select
          value={pipelineId ?? ""}
          onChange={(e) => void switchPipeline(e.target.value)}
          className="h-8 rounded-lg border border-input bg-background px-2 text-sm"
        >
          {meta.pipelines.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        {canConfigure && (
          <Button variant="ghost" size="sm" onClick={() => setEditorOpen(true)}>
            <Settings2 className="size-4" />
            Воронки
          </Button>
        )}
        <span className="flex-1" />
        <span className="text-xs text-muted-foreground">
          {deals.length} сделок{busy ? " · обновляю…" : ""}
        </span>
        {canManage && stages.length > 0 && (
          <Button size="sm" onClick={() => void addDeal(stages[0].id)}>
            <Plus className="size-4" />
            Сделка
          </Button>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-x-auto">
        <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
          <div className="flex h-full items-start gap-3 p-4">
            {stages.map((s) => (
              <Column
                key={s.id}
                stage={s}
                deals={byStage.get(s.id) ?? []}
                showAmounts={pipeline.track_amounts}
                canManage={canManage}
                onOpen={openCard}
                onAdd={addDeal}
              />
            ))}
          </div>
          <DragOverlay>
            {dragDeal && (
              <div className="w-72 rotate-1">
                <DealCard deal={dragDeal} onOpen={() => {}} />
              </div>
            )}
          </DragOverlay>
        </DndContext>
      </div>

      <SidePanel
        open={!!openDeal}
        onOpenChange={(o) => !o && setOpenDeal(null)}
        title={openDeal?.deal.title || "Сделка"}
      >
        {openDeal && (
          <DealPanel
            deal={openDeal.deal}
            history={openDeal.history}
            meta={meta}
            stages={stages}
            trackAmounts={pipeline.track_amounts}
            canManage={canManage}
            onChanged={onDealChanged}
          />
        )}
      </SidePanel>

      {editorOpen && (
        <PipelineDialog
          open={editorOpen}
          onOpenChange={setEditorOpen}
          meta={meta}
          pipelineId={pipeline.id}
          onMetaChanged={(next, nextPipelineId) => {
            setMeta(next);
            if (nextPipelineId && nextPipelineId !== pipelineId) void switchPipeline(nextPipelineId);
            else void reloadDeals();
          }}
        />
      )}
    </div>
  );
}


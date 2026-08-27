"use client";

// Карточка сделки: полоса этапов, поля, атрибуция и история.
//
// Правки уходят точечными PATCH и применяются оптимистично — экран получает
// новую строку через `onChanged` и не перечитывает всю доску: список на сотни
// сделок ради одной правки перечитывать незачем.

import { useState } from "react";
import { Check, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/core/client";
import type { CrmMeta, DealHistoryEntry, DealRow, PipelineStage } from "@/lib/core/crm";
import { useV2Store } from "@/lib/core/ui-store";

const UTM_FIELDS = [
  ["utm_source", "utm_source"],
  ["utm_medium", "utm_medium"],
  ["utm_campaign", "utm_campaign"],
  ["utm_term", "utm_term"],
  ["utm_content", "utm_content"],
  ["referrer", "referrer"],
  ["landing_page", "посадочная"],
] as const;

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[104px_1fr] items-center gap-3 text-sm">
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export function DealPanel({
  deal,
  history,
  meta,
  stages,
  trackAmounts,
  canManage,
  onChanged,
}: {
  deal: DealRow;
  history: DealHistoryEntry[];
  meta: CrmMeta;
  stages: PipelineStage[];
  trackAmounts: boolean;
  canManage: boolean;
  onChanged: (next: DealRow | null, id: string) => void;
}) {
  const { orgId, members } = useV2Store();
  const [title, setTitle] = useState(deal.title);
  const [amount, setAmount] = useState(deal.amount === null ? "" : String(deal.amount));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAttribution, setShowAttribution] = useState(false);

  const stage = stages.find((s) => s.id === deal.stage_id);
  const lostStage = stages.find((s) => s.kind === "lost");
  const wonStage = stages.find((s) => s.kind === "won");

  async function patch(body: Record<string, unknown>) {
    if (!orgId || !canManage) return;
    setSaving(true);
    setError(null);
    try {
      const next = await api.patch<DealRow>(`/orgs/${orgId}/crm/deals/${deal.id}`, body);
      onChanged(next, deal.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось сохранить");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!orgId || !window.confirm("Удалить сделку? Её история продаж исчезнет вместе с ней.")) return;
    await api.del(`/orgs/${orgId}/crm/deals/${deal.id}`);
    onChanged(null, deal.id);
  }

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-4">
      {/* Полоса этапов: пройденные подсвечены, текущий залит. Клик — перенос,
          и он же пишет строку в историю на сервере. */}
      <div className="flex gap-1">
        {stages
          .filter((s) => s.kind === "open")
          .map((s, i) => {
            const currentIndex = stages.filter((x) => x.kind === "open").findIndex((x) => x.id === deal.stage_id);
            const done = currentIndex >= 0 && i < currentIndex;
            const current = s.id === deal.stage_id;
            return (
              <button
                key={s.id}
                disabled={!canManage || saving}
                onClick={() => void patch({ stage_id: s.id })}
                className={`flex-1 truncate rounded-md px-1.5 py-1 text-[11px] font-medium transition ${
                  current
                    ? "bg-primary text-primary-foreground"
                    : done
                      ? "bg-primary/15 text-primary"
                      : "bg-muted text-muted-foreground hover:bg-muted/80"
                }`}
                title={s.name}
              >
                {s.name}
              </button>
            );
          })}
      </div>

      {canManage && (
        <div className="flex gap-2">
          {wonStage && deal.stage_id !== wonStage.id && (
            <Button
              size="sm"
              variant="outline"
              className="text-emerald-700"
              onClick={() => void patch({ stage_id: wonStage.id })}
            >
              <Check className="size-4" />
              Выиграна
            </Button>
          )}
          {lostStage && deal.stage_id !== lostStage.id && (
            <Button size="sm" variant="ghost" onClick={() => void patch({ stage_id: lostStage.id })}>
              <X className="size-4" />
              Проиграна
            </Button>
          )}
          <span className="flex-1" />
          <Button size="sm" variant="ghost" onClick={() => void remove()} title="Удалить сделку">
            <Trash2 className="size-4" />
          </Button>
        </div>
      )}

      <Input
        value={title}
        disabled={!canManage}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={() => title !== deal.title && void patch({ title })}
        className="text-base font-semibold"
        placeholder="Название сделки"
      />

      {error && <div className="text-xs text-destructive">{error}</div>}

      <div className="flex flex-col gap-2.5">
        {trackAmounts && (
          <Row label="Сумма">
            <Input
              value={amount}
              disabled={!canManage}
              inputMode="decimal"
              onChange={(e) => setAmount(e.target.value)}
              onBlur={() => {
                const next = amount.trim() === "" ? null : Number(amount.replace(",", "."));
                if (next !== null && Number.isNaN(next)) return;
                if (next !== deal.amount) void patch({ amount: next });
              }}
              className="h-8"
              placeholder="—"
            />
          </Row>
        )}

        <Row label="Этап">
          <span className="inline-flex items-center gap-2 text-sm">
            <span className="size-2 rounded-full" style={{ backgroundColor: stage?.color }} />
            {stage?.name ?? "—"}
            {stage && stage.kind === "open" && stage.probability > 0 && (
              <span className="text-xs text-muted-foreground">{stage.probability}%</span>
            )}
          </span>
        </Row>

        <Row label="Ответственный">
          <select
            value={deal.assignee_id ?? ""}
            disabled={!canManage}
            onChange={(e) => void patch({ assignee_id: e.target.value || null })}
            className="h-8 w-full rounded-lg border border-input bg-background px-2 text-sm"
          >
            <option value="">— не назначен</option>
            {members.map((m) => (
              <option key={m.user_id} value={m.user_id}>
                {m.name || m.email}
              </option>
            ))}
          </select>
        </Row>

        <Row label="Источник">
          <select
            value={deal.source_id ?? ""}
            disabled={!canManage}
            onChange={(e) => void patch({ source_id: e.target.value || null })}
            className="h-8 w-full rounded-lg border border-input bg-background px-2 text-sm"
          >
            <option value="">— не указан</option>
            {meta.sources.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </Row>

        {/* Причина отказа спрашивается только у проигранной: без неё аналитика
            проигрышей слепая, а у живой сделки поле было бы шумом. */}
        {stage?.kind === "lost" && (
          <Row label="Причина">
            <select
              value={deal.lost_reason_id ?? ""}
              disabled={!canManage}
              onChange={(e) => void patch({ lost_reason_id: e.target.value || null })}
              className="h-8 w-full rounded-lg border border-input bg-background px-2 text-sm"
            >
              <option value="">— не указана</option>
              {meta.lost_reasons.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </Row>
        )}

        <Row label="Контакт">
          <div className="flex flex-col gap-1.5">
            <Input
              defaultValue={deal.contact_name}
              disabled={!canManage}
              placeholder="Имя"
              className="h-8"
              onBlur={(e) => e.target.value !== deal.contact_name && void patch({ contact_name: e.target.value })}
            />
            <Input
              defaultValue={deal.contact_phone}
              disabled={!canManage}
              placeholder="Телефон"
              className="h-8"
              onBlur={(e) => e.target.value !== deal.contact_phone && void patch({ contact_phone: e.target.value })}
            />
            <Input
              defaultValue={deal.contact_telegram}
              disabled={!canManage}
              placeholder="Telegram"
              className="h-8"
              onBlur={(e) =>
                e.target.value !== deal.contact_telegram && void patch({ contact_telegram: e.target.value })
              }
            />
          </div>
        </Row>
      </div>

      <div>
        <button
          onClick={() => setShowAttribution((v) => !v)}
          className="text-xs font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground"
        >
          Привлечение {showAttribution ? "▾" : "▸"}
        </button>
        {showAttribution && (
          <div className="mt-2 flex flex-col gap-1.5 rounded-xl bg-muted/40 p-3">
            {UTM_FIELDS.map(([field, label]) => (
              <div key={field} className="grid grid-cols-[110px_1fr] items-center gap-2">
                <span className="font-mono text-[11px] text-muted-foreground">{label}</span>
                <Input
                  defaultValue={(deal as unknown as Record<string, string>)[field] ?? ""}
                  disabled={!canManage}
                  className="h-7 font-mono text-xs"
                  onBlur={(e) => {
                    const cur = (deal as unknown as Record<string, string>)[field] ?? "";
                    if (e.target.value !== cur) void patch({ [field]: e.target.value });
                  }}
                />
              </div>
            ))}
          </div>
        )}
      </div>

      <div>
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          История этапов
        </div>
        <div className="flex flex-col gap-2">
          {history.map((h) => (
            <div key={h.id} className="flex gap-2 text-xs">
              <span className="w-28 shrink-0 font-mono text-[11px] text-muted-foreground">
                {new Date(h.entered_at).toLocaleString("ru-RU", {
                  day: "2-digit",
                  month: "short",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
              <span>
                <span className="font-medium">{h.stage_name}</span>
                {h.actor_name && <span className="text-muted-foreground"> · {h.actor_name}</span>}
              </span>
            </div>
          ))}
          {history.length === 0 && <div className="text-xs text-muted-foreground">Пока пусто</div>}
        </div>
      </div>
    </div>
  );
}

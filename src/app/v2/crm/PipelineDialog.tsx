"use client";

// Редактор воронок: список воронок, создание из шаблона, правка этапов.
//
// Два правила отсюда видны глазом и держатся сервером: воронка рождается
// непустой (шаблон обязателен, пустую завести нечем) и итоговые этапы
// «Выиграно»/«Проиграно» не удаляются — без них не считается ни одна конверсия.

import { useState } from "react";
import { Lock, Plus, Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/core/client";
import { PIPELINE_TEMPLATES, stageDeleteBlock, stageDeleteMessage } from "@/lib/core/crm-model";
import type { CrmMeta, Pipeline, PipelineStage } from "@/lib/core/crm";
import { useV2Store } from "@/lib/core/ui-store";

export function PipelineDialog({
  open,
  onOpenChange,
  meta,
  pipelineId,
  onMetaChanged,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  meta: CrmMeta;
  pipelineId: string;
  onMetaChanged: (next: CrmMeta, nextPipelineId?: string) => void;
}) {
  const { orgId } = useV2Store();
  const [selected, setSelected] = useState(pipelineId);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [template, setTemplate] = useState<keyof typeof PIPELINE_TEMPLATES>("sales");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const pipeline = meta.pipelines.find((p) => p.id === selected);
  const stages = meta.stages
    .filter((s) => s.pipeline_id === selected && !s.archived_at)
    .sort((a, b) => a.position - b.position);

  async function refresh(nextPipelineId?: string) {
    if (!orgId) return;
    const next = await api.get<CrmMeta>(`/orgs/${orgId}/crm/meta`);
    onMetaChanged(next, nextPipelineId);
  }

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не получилось");
    } finally {
      setBusy(false);
    }
  }

  const createPipeline = () =>
    run(async () => {
      if (!orgId || !newName.trim()) return;
      const created = await api.post<{ pipeline: Pipeline; stages: PipelineStage[] }>(
        `/orgs/${orgId}/crm/pipelines`,
        { name: newName.trim(), template },
      );
      setNewName("");
      setCreating(false);
      setSelected(created.pipeline.id);
      await refresh(created.pipeline.id);
    });

  const addStage = () =>
    run(async () => {
      if (!orgId) return;
      await api.post(`/orgs/${orgId}/crm/pipelines/${selected}/stages`, { name: "Новый этап" });
      await refresh();
    });

  const removeStage = (stage: PipelineStage) =>
    run(async () => {
      if (!orgId) return;
      const block = stageDeleteBlock(stages, stage.id);
      if (block) {
        setError(stageDeleteMessage(block));
        return;
      }
      await api.del(`/orgs/${orgId}/crm/stages/${stage.id}`);
      await refresh();
    });

  const renameStage = (stage: PipelineStage, name: string) =>
    run(async () => {
      if (!orgId || name === stage.name || !name.trim()) return;
      await api.patch(`/orgs/${orgId}/crm/stages/${stage.id}`, { name });
      await refresh();
    });

  const setProbability = (stage: PipelineStage, value: string) =>
    run(async () => {
      const probability = Number(value);
      if (!orgId || Number.isNaN(probability) || probability === stage.probability) return;
      await api.patch(`/orgs/${orgId}/crm/stages/${stage.id}`, {
        probability: Math.max(0, Math.min(100, Math.round(probability))),
      });
      await refresh();
    });

  const savePipeline = (patch: Record<string, unknown>) =>
    run(async () => {
      if (!orgId) return;
      await api.patch(`/orgs/${orgId}/crm/pipelines/${selected}`, patch);
      await refresh();
    });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogTitle>Воронки</DialogTitle>

        <div className="flex flex-wrap items-center gap-2">
          {meta.pipelines.map((p) => (
            <button
              key={p.id}
              onClick={() => setSelected(p.id)}
              className={`rounded-lg px-2.5 py-1 text-sm transition ${
                p.id === selected ? "bg-foreground text-background" : "bg-muted hover:bg-muted/70"
              }`}
            >
              {p.name}
              {p.is_default && <span className="ml-1.5 text-[10px] opacity-70">по умолч.</span>}
            </button>
          ))}
          <Button size="sm" variant="ghost" onClick={() => setCreating((v) => !v)}>
            <Plus className="size-4" />
            Новая
          </Button>
        </div>

        {creating && (
          <div className="flex flex-col gap-2 rounded-xl border p-3">
            <Input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Название воронки"
            />
            <div className="flex flex-col gap-1">
              {(Object.keys(PIPELINE_TEMPLATES) as Array<keyof typeof PIPELINE_TEMPLATES>).map((key) => (
                <label key={key} className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    checked={template === key}
                    onChange={() => setTemplate(key)}
                  />
                  <span>
                    {PIPELINE_TEMPLATES[key].title}
                    <span className="ml-2 text-xs text-muted-foreground">
                      {PIPELINE_TEMPLATES[key].stages.map((s) => s.name).join(" → ")}
                    </span>
                  </span>
                </label>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              «Выиграно» и «Проиграно» есть в каждой воронке: без них не посчитать конверсию.
            </p>
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={() => setCreating(false)}>
                Отмена
              </Button>
              <Button size="sm" disabled={busy || !newName.trim()} onClick={() => void createPipeline()}>
                Создать
              </Button>
            </div>
          </div>
        )}

        {pipeline && (
          <>
            <div className="flex items-center gap-3">
              <Input
                defaultValue={pipeline.name}
                key={pipeline.id}
                onBlur={(e) => e.target.value !== pipeline.name && void savePipeline({ name: e.target.value })}
                className="h-8"
              />
              <label className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={pipeline.track_amounts}
                  onChange={(e) => void savePipeline({ track_amounts: e.target.checked })}
                />
                Считать деньги
              </label>
              {!pipeline.is_default && (
                <button
                  onClick={() => void savePipeline({ is_default: true })}
                  className="shrink-0 text-xs text-muted-foreground underline hover:text-foreground"
                >
                  Сделать основной
                </button>
              )}
            </div>

            <div className="flex flex-col gap-1.5">
              {stages.map((s) => (
                <div
                  key={s.id}
                  className={`flex items-center gap-2 rounded-lg border px-2 py-1.5 ${
                    s.kind === "open" ? "bg-background" : "bg-muted/40"
                  }`}
                >
                  <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: s.color }} />
                  <Input
                    defaultValue={s.name}
                    className="h-7 flex-1 border-transparent bg-transparent"
                    onBlur={(e) => void renameStage(s, e.target.value)}
                  />
                  <span className="shrink-0 text-[10px] uppercase text-muted-foreground">
                    {s.kind === "open" ? "в работе" : "итог"}
                  </span>
                  <Input
                    defaultValue={String(s.probability)}
                    className="h-7 w-14 text-right font-mono text-xs"
                    onBlur={(e) => void setProbability(s, e.target.value)}
                  />
                  {s.kind === "open" ? (
                    <button
                      onClick={() => void removeStage(s)}
                      title="Удалить этап"
                      className="shrink-0 rounded p-1 text-muted-foreground hover:bg-muted hover:text-destructive"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  ) : (
                    <Lock className="size-3.5 shrink-0 text-muted-foreground/50" />
                  )}
                </div>
              ))}
              <Button size="sm" variant="outline" onClick={() => void addStage()} disabled={busy}>
                <Plus className="size-4" />
                Добавить этап
              </Button>
              <p className="text-xs text-muted-foreground">
                Удалённый этап пропадает с доски, но остаётся в отчётах за прошлые периоды — иначе
                воронка за прошлый месяц перестала бы сходиться.
              </p>
            </div>
          </>
        )}

        {error && <div className="text-sm text-destructive">{error}</div>}
      </DialogContent>
    </Dialog>
  );
}

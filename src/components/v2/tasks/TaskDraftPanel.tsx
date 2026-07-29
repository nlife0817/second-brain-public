"use client";

// Развёрнутый черновик: та же будущая задача, что набрана в строке, но со
// всеми полями сразу — включая описание и кастомные поля. Крестик сворачивает
// обратно в строку и ничего не теряет; «Отменить» — единственное место, где
// черновик действительно исчезает.

import dynamic from "next/dynamic";
import { Calendar, ChevronsRight, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Avatar, PRIORITY_LABELS, StatusPill } from "@/components/v2/bits";
import { MemberPicker } from "@/components/v2/MemberPicker";
import { SidePanel } from "@/components/v2/SidePanel";
import type { TaskDraft } from "@/lib/core/task-draft";
import type { TaskPriority } from "@/lib/core/types";
import { useV2Store } from "@/lib/core/ui-store";
import { DraftFieldControl } from "./draft-fields";

const RichText = dynamic(() => import("@/components/v2/RichText").then((m) => m.RichText), {
  ssr: false,
  loading: () => (
    <div className="min-h-24 rounded-lg border border-border bg-background px-3 py-2 text-sm text-muted-foreground">
      Загрузка редактора…
    </div>
  ),
});

export function TaskDraftPanel({
  open,
  draft,
  onChange,
  onCollapse,
  onCancel,
  onSave,
  saving,
  error,
}: {
  open: boolean;
  draft: TaskDraft;
  onChange: (patch: Partial<TaskDraft>) => void;
  /** Свернуть обратно в строку — черновик остаётся. */
  onCollapse: () => void;
  /** Отказаться от черновика совсем. */
  onCancel: () => void;
  onSave: () => void;
  saving: boolean;
  error: string | null;
}) {
  const { statuses, tags, projects, members, fields } = useV2Store();

  const assignees = draft.assignee_ids
    .map((id) => members.find((m) => m.user_id === id))
    .filter((m): m is NonNullable<typeof m> => !!m)
    .map((m) => ({ id: m.user_id, email: m.email, name: m.name, avatar_url: m.avatar_url }));

  // Поле проекта показываем только если задача в этот проект и правда попадёт.
  const visibleFields = fields.filter(
    (f) => !f.project_id || draft.project_ids.includes(f.project_id),
  );

  return (
    <SidePanel open={open} onOpenChange={(next) => !next && onCollapse()} title="Новая задача">
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <span className="text-sm font-semibold">Новая задача</span>
        <span className="flex-1" />
        <Button
          variant="ghost"
          size="icon-sm"
          className="size-9 sm:size-7"
          onClick={onCollapse}
          title="Свернуть в строку — черновик сохранится"
        >
          <ChevronsRight className="size-4" />
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="flex flex-col gap-4 px-4 py-4">
          <Input
            autoFocus
            value={draft.title}
            onChange={(e) => onChange({ title: e.target.value })}
            placeholder="Что нужно сделать?"
            className="border-none px-0 text-lg font-semibold shadow-none focus-visible:ring-0"
          />

          <div className="grid grid-cols-[110px_1fr] items-center gap-x-3 gap-y-2.5 text-sm">
            <span className="text-muted-foreground">Статус</span>
            <Select
              value={draft.status_id ?? ""}
              onValueChange={(v) => onChange({ status_id: v || null })}
            >
              <SelectTrigger size="sm" className="w-fit min-w-36">
                <SelectValue placeholder="Без статуса">
                  <StatusPill status={statuses.find((s) => s.id === draft.status_id)} />
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {statuses.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <span className="text-muted-foreground">Приоритет</span>
            <Select
              value={draft.priority}
              onValueChange={(v) => v && onChange({ priority: v as TaskPriority })}
            >
              <SelectTrigger size="sm" className="w-fit min-w-36">
                <SelectValue>{PRIORITY_LABELS[draft.priority].label}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(PRIORITY_LABELS) as TaskPriority[]).map((p) => (
                  <SelectItem key={p} value={p}>
                    {PRIORITY_LABELS[p].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <span className="text-muted-foreground">Срок</span>
            <div className="flex items-center gap-2">
              <Calendar className="size-4 text-muted-foreground" />
              <input
                type="date"
                value={draft.due_date ?? ""}
                onChange={(e) =>
                  onChange({
                    due_date: e.target.value || null,
                    // Время без даты сервер не примет.
                    due_time: e.target.value ? draft.due_time : null,
                  })
                }
                className="rounded-md border border-border bg-background px-2 py-1 text-sm"
              />
              <input
                type="time"
                value={draft.due_time?.slice(0, 5) ?? ""}
                disabled={!draft.due_date}
                onChange={(e) => onChange({ due_time: e.target.value || null })}
                className="rounded-md border border-border bg-background px-2 py-1 text-sm disabled:opacity-50"
              />
            </div>

            <span className="text-muted-foreground">Оценка</span>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={0}
                step={5}
                value={draft.estimated_minutes ?? ""}
                onChange={(e) =>
                  onChange({
                    estimated_minutes:
                      e.target.value === "" ? null : Math.max(0, Number(e.target.value)),
                  })
                }
                className="h-8 w-24 rounded-md border border-border bg-background px-2 text-sm"
              />
              <span className="text-xs text-muted-foreground">минут</span>
            </div>

            <span className="text-muted-foreground">Исполнители</span>
            <div className="flex flex-wrap items-center gap-1.5">
              {assignees.map((a) => (
                <span
                  key={a.id}
                  className="inline-flex items-center gap-1 rounded-full bg-muted py-0.5 pl-0.5 pr-2 text-xs"
                >
                  <Avatar user={a} size="xs" />
                  {a.name || a.email}
                  <button
                    className="text-muted-foreground hover:text-foreground"
                    onClick={() =>
                      onChange({ assignee_ids: draft.assignee_ids.filter((x) => x !== a.id) })
                    }
                  >
                    <X className="size-3" />
                  </button>
                </span>
              ))}
              <MemberPicker
                selected={assignees}
                onChange={(ids) => onChange({ assignee_ids: ids })}
              />
            </div>

            <span className="text-muted-foreground">Теги</span>
            <div className="flex flex-wrap items-center gap-1.5">
              {tags.map((t) => {
                const active = draft.tag_ids.includes(t.id);
                return (
                  <button
                    key={t.id}
                    onClick={() =>
                      onChange({
                        tag_ids: active
                          ? draft.tag_ids.filter((x) => x !== t.id)
                          : [...draft.tag_ids, t.id],
                      })
                    }
                    className={
                      "rounded-full px-2 py-0.5 text-[11px] font-medium transition-opacity " +
                      (active ? "" : "opacity-40 hover:opacity-80")
                    }
                    style={{ backgroundColor: `${t.color}1a`, color: t.color }}
                  >
                    {t.name}
                  </button>
                );
              })}
              {tags.length === 0 && <span className="text-xs text-muted-foreground">Нет тегов</span>}
            </div>

            <span className="text-muted-foreground">Проекты</span>
            <div className="flex flex-wrap items-center gap-1.5">
              {draft.project_ids.map((pid) => {
                const project = projects.find((p) => p.id === pid);
                return (
                  <span
                    key={pid}
                    className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2 py-0.5 text-xs"
                  >
                    <span
                      className="size-2 rounded-sm"
                      style={{ backgroundColor: project?.color ?? "#6b7280" }}
                    />
                    {project?.name ?? "Недоступный проект"}
                    <button
                      className="text-muted-foreground hover:text-foreground"
                      onClick={() =>
                        onChange({ project_ids: draft.project_ids.filter((x) => x !== pid) })
                      }
                    >
                      <X className="size-3" />
                    </button>
                  </span>
                );
              })}
              <Select
                value=""
                onValueChange={(v) => {
                  if (v) onChange({ project_ids: [...draft.project_ids, v] });
                }}
              >
                <SelectTrigger
                  size="sm"
                  className="h-6 w-fit border-dashed text-xs text-muted-foreground"
                >
                  <Plus className="size-3" /> В проект
                </SelectTrigger>
                <SelectContent>
                  {projects
                    .filter(
                      (p) =>
                        !draft.project_ids.includes(p.id) &&
                        !p.archived_at &&
                        (p.my_role === "admin" || p.my_role === "editor"),
                    )
                    .map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
              {draft.project_ids.length === 0 && (
                <span className="text-xs text-muted-foreground">Личная задача</span>
              )}
            </div>

            {visibleFields.map((f) => (
              <FieldRow key={f.id} label={f.name}>
                <DraftFieldControl
                  field={f}
                  value={draft.field_values[f.id]}
                  onChange={(value) =>
                    onChange({ field_values: { ...draft.field_values, [f.id]: value } })
                  }
                />
              </FieldRow>
            ))}
          </div>

          <RichText
            value={draft.description}
            onSave={(html) => onChange({ description: html })}
            placeholder="Добавьте описание…"
          />

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
      </div>

      <div className="flex items-center gap-2 border-t border-border px-4 py-3">
        <p className="flex-1 text-xs text-muted-foreground">
          Закрыть панель — вернуться к строчному вводу, черновик сохранится.
        </p>
        <Button variant="ghost" size="sm" onClick={onCancel} disabled={saving}>
          Отменить
        </Button>
        <Button size="sm" onClick={onSave} disabled={saving || !draft.title.trim()}>
          {saving ? "Сохранение…" : "Сохранить"}
        </Button>
      </div>
    </SidePanel>
  );
}

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <span className="truncate text-muted-foreground" title={label}>
        {label}
      </span>
      <div className="min-w-0">{children}</div>
    </>
  );
}

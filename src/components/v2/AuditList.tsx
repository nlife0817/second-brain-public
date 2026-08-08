"use client";

// Журнал действий организации. Клиентский компонент ради одного: время должно
// быть в часовом поясе читателя, а не сервера (на VPS это UTC).
//
// Общий для блока в настройках (первые записи) и для экрана «все действия».

import { actorSourceLabel } from "@/lib/core/actor-source";
import type { CoreEvent } from "@/lib/core/types";

const VERB_LABELS: Record<string, string> = {
  "task.created": "создал(а) задачу",
  "task.updated": "изменил(а) задачу",
  "task.status_changed": "сменил(а) статус задачи",
  "task.completed": "завершил(а) задачу",
  "task.assigned": "изменил(а) исполнителей",
  "task.homed": "добавил(а) задачу в проект",
  "task.unhomed": "убрал(а) задачу из проекта",
  "task.deleted": "удалил(а) задачу",
  "comment.added": "оставил(а) комментарий",
  "project.created": "создал(а) проект",
  "project.updated": "изменил(а) проект",
  "project.archived": "архивировал(а) проект",
  "project.unarchived": "вернул(а) проект из архива",
  "project.deleted": "удалил(а) проект",
  "member.added": "добавил(а) участника",
  "member.removed": "убрал(а) участника",
  "member.role_changed": "сменил(а) роль участника",
};

function label(e: CoreEvent): string {
  const base = VERB_LABELS[e.verb] ?? e.verb;
  const title = (e.payload as { name?: string; title?: string } | null)?.name;
  return title ? `${base} «${title}»` : base;
}

export function AuditList({ events }: { events: CoreEvent[] }) {
  if (events.length === 0) {
    return <p className="text-sm text-muted-foreground">Записей нет</p>;
  }
  return (
    <div className="flex flex-col gap-1">
      {events.map((e) => (
        <p key={e.id} className="text-xs text-muted-foreground">
          <span className="font-medium text-foreground">
            {e.actor?.name || e.actor?.email || "Система"}
          </span>{" "}
          {label(e)}
          {/* Сделано интеграцией, а не руками: в журнале это важнее всего. */}
          {actorSourceLabel(e.source) && <> ({actorSourceLabel(e.source)})</>} ·{" "}
          {new Date(e.created_at).toLocaleString("ru-RU", {
            day: "numeric",
            month: "short",
            hour: "2-digit",
            minute: "2-digit",
          })}
        </p>
      ))}
    </div>
  );
}

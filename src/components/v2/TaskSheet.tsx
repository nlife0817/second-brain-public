"use client";

// Карточка задачи: поля, исполнители, проекты (multi-homing), кастомные поля,
// подзадачи, комментарии и лента активности. Сохранение — по действию (PATCH).

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Bell,
  BellOff,
  Calendar,
  CheckCircle2,
  Circle,
  Play,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SheetHeader } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/core/client";
import type { TaskChange } from "@/lib/core/task-change";
import type {
  CoreComment,
  CoreEvent,
  CustomField,
  RelationType,
  RelationWithTarget,
  TaskDetail,
  TaskPriority,
  TaskListItem,
} from "@/lib/core/types";
import { useV2Store, useV2StoreApi } from "@/lib/core/ui-store";
import { cn } from "@/lib/utils";
import { Avatar, PRIORITY_LABELS, StatusPill } from "./bits";
import { MemberPicker } from "./MemberPicker";
import { RelationsList } from "./RelationsList";
import { SidePanel } from "./SidePanel";
// Tiptap — самая тяжёлая зависимость интерфейса (≈370 КБ). Статический импорт
// тянул её в бандл каждой страницы v2, хотя редактор нужен только когда открыта
// карточка задачи. Грузим чанк при первом открытии.
const RichText = dynamic(() => import("./RichText").then((m) => m.RichText), {
  ssr: false,
  loading: () => (
    <div className="min-h-24 rounded-lg border border-border bg-background px-3 py-2 text-sm text-muted-foreground">
      Загрузка редактора…
    </div>
  ),
});

const VERB_LABELS: Record<string, string> = {
  "task.created": "создал(а) задачу",
  "task.updated": "изменил(а) задачу",
  "task.status_changed": "сменил(а) статус",
  "task.completed": "завершил(а) задачу",
  "task.assigned": "изменил(а) исполнителей",
  "task.homed": "добавил(а) в проект",
  "task.unhomed": "убрал(а) из проекта",
  "task.deleted": "удалил(а) задачу",
  "comment.added": "оставил(а) комментарий",
};

function eventLabel(e: CoreEvent): string {
  const base = VERB_LABELS[e.verb] ?? e.verb;
  if (e.verb === "task.status_changed" || e.verb === "task.completed") {
    const p = e.payload as { from?: string | null; to?: string | null };
    if (p.to) return `${base}: ${p.from ?? "—"} → ${p.to}`;
  }
  if (e.verb === "task.updated") {
    const p = e.payload as { fields?: string[] };
    if (p.fields?.length) return `${base} (${p.fields.join(", ")})`;
  }
  return base;
}

/** Ответ /tasks/:id/bundle — всё содержимое карточки за один запрос. */
interface TaskBundle {
  task: TaskDetail;
  comments: CoreComment[];
  feed: CoreEvent[];
  subtasks: TaskListItem[];
  relations: RelationWithTarget[];
  relation_types: RelationType[];
}

export function TaskSheet({
  taskId,
  onClose,
  onChanged,
}: {
  taskId: string | null;
  onClose: () => void;
  onChanged?: (change: TaskChange) => void;
}) {
  // Кастомные поля — справочник организации из стора: раньше карточка тянула
  // /fields при каждом открытии.
  const { orgId, statuses, tags, projects, me, fields, orgRole } = useV2Store();
  const storeApi = useV2StoreApi();
  // Гость связями не управляет; более тонкие права проверит сервер.
  const canEdit = orgRole !== null && orgRole !== "guest";
  const [loaded, setLoaded] = useState<TaskDetail | null>(null);
  // Пока грузится новая задача, старую не показываем — сравнение по id вместо
  // сброса состояния в эффекте (тот вызывает каскадный ре-рендер).
  const task = loaded && loaded.id === taskId ? loaded : null;
  const setTask = setLoaded;
  const [comments, setComments] = useState<CoreComment[]>([]);
  const [feed, setFeed] = useState<CoreEvent[]>([]);
  const [subtasks, setSubtasks] = useState<TaskListItem[]>([]);
  const [relations, setRelations] = useState<RelationWithTarget[]>([]);
  const [relationTypes, setRelationTypes] = useState<RelationType[]>([]);
  const [tab, setTab] = useState<"comments" | "feed">("comments");
  const [commentText, setCommentText] = useState("");
  const [subtaskTitle, setSubtaskTitle] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Быстрое переключение задач: ответ по прежней задаче не должен перетереть текущую.
  const currentTaskRef = useRef<string | null>(null);

  const load = useCallback(async () => {
    if (!orgId || !taskId) return;
    try {
      // Один запрос вместо шести: карточка, комментарии, лента, подзадачи и
      // блок связей считаются на сервере параллельно под общей авторизацией.
      const b = await api.get<TaskBundle>(`/orgs/${orgId}/tasks/${taskId}/bundle`);
      if (currentTaskRef.current !== taskId) return;
      setTask(b.task);
      setComments(b.comments);
      setFeed(b.feed);
      setSubtasks(b.subtasks);
      setRelations(b.relations);
      setRelationTypes(b.relation_types);
      setError(null);
    } catch (e) {
      if (currentTaskRef.current !== taskId) return;
      setError(e instanceof Error ? e.message : "Не удалось загрузить задачу");
    }
  }, [orgId, taskId]);

  useEffect(() => {
    currentTaskRef.current = taskId;
    if (taskId) void load();
  }, [taskId, load]);

  /** Единая точка вызова API: показывает ошибку вместо тихого падения. */
  async function run(fn: () => Promise<void>) {
    try {
      await fn();
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось выполнить действие");
    }
  }

  /**
   * Предсказание ответа сервера для мгновенной перерисовки. Поля, которые
   * сервер выводит сам (метка завершения — по виду статуса), считаем по тем же
   * правилам; расхождение поправит настоящий ответ через мгновение.
   */
  function previewPatch(prev: TaskDetail, body: Record<string, unknown>): TaskDetail {
    const next: TaskDetail = { ...prev };
    if (typeof body.title === "string") next.title = body.title;
    if (typeof body.description === "string") next.description = body.description;
    if (typeof body.priority === "string") next.priority = body.priority as TaskPriority;
    if ("due_date" in body) next.due_date = body.due_date as string | null;
    if ("due_time" in body) next.due_time = body.due_time as string | null;
    if (typeof body.status_id === "string") {
      next.status_id = body.status_id;
      const kind = statuses.find((s) => s.id === body.status_id)?.kind;
      if (kind === "done") next.completed_at = prev.completed_at ?? new Date().toISOString();
      else if (kind === "open") next.completed_at = null;
    }
    if (Array.isArray(body.tag_ids)) {
      const ids = body.tag_ids as string[];
      next.tags = ids
        .map((id) => tags.find((t) => t.id === id))
        .filter((t): t is NonNullable<typeof t> => !!t);
    }
    return next;
  }

  /**
   * Правка задачи. Карточка и список за ней перерисовываются сразу, запрос уходит
   * следом; при отказе состояние возвращается на место.
   */
  async function patch(
    body: Record<string, unknown>,
    preview?: (task: TaskDetail) => TaskDetail,
  ) {
    if (!orgId || !taskId || !task) return;
    const previous = task;
    const base = previewPatch(task, body);
    const optimistic = preview ? preview(base) : base;
    setTask(optimistic);
    onChanged?.({ type: "patched", task: optimistic, confirmed: false });
    try {
      const updated = await api.patch<TaskDetail>(`/orgs/${orgId}/tasks/${taskId}`, body);
      if (currentTaskRef.current !== taskId) return;
      setTask(updated);
      onChanged?.({ type: "patched", task: updated, confirmed: true });
      setError(null);
    } catch (e) {
      if (currentTaskRef.current !== taskId) return;
      setTask(previous);
      onChanged?.({ type: "patched", task: previous, confirmed: true });
      setError(e instanceof Error ? e.message : "Не удалось выполнить действие");
    }
  }

  /** Многострочный ввод → HTML: иначе переносы строк теряются при рендере. */
  function textToHtml(text: string): string {
    const escape = (s: string) =>
      s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    return text
      .split(/\n{2,}/)
      .map((block) => `<p>${block.split("\n").map(escape).join("<br>")}</p>`)
      .join("");
  }

  async function addComment() {
    if (!orgId || !taskId || !commentText.trim()) return;
    const text = commentText.trim();
    // Поле очищаем сразу: ждать ответа сервера, чтобы убрать свой же текст,
    // выглядит как зависшая кнопка.
    setCommentText("");
    await run(async () => {
      const comment = await api.post<CoreComment>(`/orgs/${orgId}/tasks/${taskId}/comments`, {
        body: textToHtml(text),
      });
      if (currentTaskRef.current !== taskId) return;
      setComments((prev) => [...prev, comment]);
      setTask((prev) => {
        if (!prev) return prev;
        const next = { ...prev, comment_count: prev.comment_count + 1 };
        onChanged?.({ type: "patched", task: next, confirmed: true });
        return next;
      });
    });
  }

  async function addSubtask() {
    if (!orgId || !taskId || !subtaskTitle.trim()) return;
    const title = subtaskTitle.trim();
    setSubtaskTitle("");
    await run(async () => {
      // Ответ на создание — сама подзадача: отдельный перечит списка не нужен.
      const created = await api.post<TaskDetail>(`/orgs/${orgId}/tasks`, {
        title,
        parent_task_id: taskId,
      });
      if (currentTaskRef.current !== taskId) return;
      setSubtasks((prev) => [...prev, created]);
      setTask((prev) => (prev ? { ...prev, subtask_count: prev.subtask_count + 1 } : prev));
      // В списках экрана появилась новая задача — их надо перечитать.
      onChanged?.({ type: "reload" });
    });
  }

  async function toggleSubtaskDone(sub: TaskListItem) {
    if (!orgId) return;
    const doneStatus = statuses.find((s) => s.kind === "done");
    const openStatus = reopenStatus();
    const target = sub.completed_at ? openStatus : doneStatus;
    if (!target) return;
    const wasDone = !!sub.completed_at;
    const previous = subtasks;
    // Галочка переключается сразу; раньше это стоило двух походов на сервер
    // подряд — правки и полного перечита списка подзадач.
    setSubtasks((prev) =>
      prev.map((s) =>
        s.id === sub.id
          ? { ...s, status_id: target.id, completed_at: wasDone ? null : new Date().toISOString() }
          : s,
      ),
    );
    setTask((prev) => {
      if (!prev) return prev;
      const next = {
        ...prev,
        subtask_done_count: prev.subtask_done_count + (wasDone ? -1 : 1),
      };
      onChanged?.({ type: "patched", task: next, confirmed: false });
      return next;
    });
    try {
      await api.patch(`/orgs/${orgId}/tasks/${sub.id}`, { status_id: target.id });
      setError(null);
    } catch (e) {
      setSubtasks(previous);
      setTask((prev) =>
        prev
          ? { ...prev, subtask_done_count: prev.subtask_done_count + (wasDone ? 1 : -1) }
          : prev,
      );
      setError(e instanceof Error ? e.message : "Не удалось выполнить действие");
    }
  }

  async function setPlacements(projectIds: string[]) {
    if (!orgId || !taskId || !task) return;
    const placements = projectIds.map((pid) => {
      const existing = task.placements.find((p) => p.project_id === pid);
      return { project_id: pid, section_id: existing?.section_id ?? null };
    });
    const previous = task;
    const optimistic: TaskDetail = {
      ...task,
      placements: placements.map((p) => ({
        ...(task.placements.find((x) => x.project_id === p.project_id) ?? {
          project_id: p.project_id,
          section_id: p.section_id,
          position: 0,
        }),
      })),
    };
    setTask(optimistic);
    onChanged?.({ type: "patched", task: optimistic, confirmed: false });
    try {
      const updated = await api.put<TaskDetail>(`/orgs/${orgId}/tasks/${taskId}/placements`, { placements });
      if (currentTaskRef.current !== taskId) return;
      setTask(updated);
      onChanged?.({ type: "patched", task: updated, confirmed: true });
      setError(null);
    } catch (e) {
      if (currentTaskRef.current !== taskId) return;
      setTask(previous);
      onChanged?.({ type: "patched", task: previous, confirmed: true });
      setError(e instanceof Error ? e.message : "Не удалось выполнить действие");
    }
  }

  async function setFieldValue(fieldId: string, value: unknown) {
    if (!orgId || !taskId || !task) return;
    const previous = task;
    setTask((prev) =>
      prev ? { ...prev, field_values: { ...prev.field_values, [fieldId]: value } } : prev,
    );
    try {
      await api.put(`/orgs/${orgId}/tasks/${taskId}/fields/${fieldId}`, { value });
      setError(null);
    } catch (e) {
      if (currentTaskRef.current !== taskId) return;
      setTask(previous);
      setError(e instanceof Error ? e.message : "Не удалось выполнить действие");
    }
  }

  /** Список исполнителей меняем оптимистично: иначе быстрый второй выбор
   *  посчитается от старого списка и снимет только что назначенного. */
  async function setAssignees(ids: string[]) {
    const { members } = storeApi.getState();
    const optimistic = ids
      .map((id) => members.find((m) => m.user_id === id))
      .filter((m): m is NonNullable<typeof m> => !!m)
      .map((m) => ({ id: m.user_id, email: m.email, name: m.name, avatar_url: m.avatar_url }));
    // Через preview, а не отдельным setTask: иначе откат по ошибке вернул бы
    // состояние, посчитанное до этой правки, и исполнители «прыгнули» бы назад.
    await patch({ assignee_ids: ids }, (t) => ({ ...t, assignees: optimistic }));
  }

  async function removeTask() {
    if (!orgId || !taskId) return;
    if (!window.confirm("Удалить задачу безвозвратно?")) return;
    const removedId = taskId;
    await run(async () => {
      await api.del(`/orgs/${orgId}/tasks/${removedId}`);
      onChanged?.({ type: "deleted", taskId: removedId });
      onClose();
    });
  }

  /**
   * Куда возвращать задачу, если снимают отметку «завершена»: в последний
   * рабочий статус перед «Готово», а не в самый первый («Входящие») — иначе
   * снятая галочка отбрасывает задачу в начало процесса.
   */
  function reopenStatus() {
    const open = statuses.filter((s) => s.kind === "open");
    return open.length > 0 ? open[open.length - 1] : undefined;
  }

  /** Учёт времени начинается там, где идёт работа — в карточке задачи. */
  async function startTimerHere() {
    if (!orgId || !taskId) return;
    await run(async () => {
      await api.post(`/orgs/${orgId}/time/timer`, { task_id: taskId });
      setError(null);
    });
  }

  const amFollower = !!task && !!me && task.followers.some((f) => f.id === me.id);

  async function toggleFollow() {
    if (!orgId || !taskId || !task || !me) return;
    const previous = task;
    const wasFollower = amFollower;
    // Колокольчик переключается сразу. Раньше за ним шла правка и следом полный
    // перечит карточки — шесть запросов ради одной иконки.
    setTask({
      ...task,
      followers: wasFollower
        ? task.followers.filter((f) => f.id !== me.id)
        : [...task.followers, { id: me.id, email: me.email, name: me.name, avatar_url: me.avatar_url }],
    });
    try {
      if (wasFollower) await api.del(`/orgs/${orgId}/tasks/${taskId}/follow`);
      else await api.post(`/orgs/${orgId}/tasks/${taskId}/follow`);
      setError(null);
    } catch (e) {
      if (currentTaskRef.current !== taskId) return;
      setTask(previous);
      setError(e instanceof Error ? e.message : "Не удалось выполнить действие");
    }
  }

  const doneStatus = statuses.find((s) => s.kind === "done");
  const isDone = !!task?.completed_at;
  const visibleFields = fields.filter(
    (f) => !f.project_id || task?.placements.some((p) => p.project_id === f.project_id),
  );

  return (
    <SidePanel open={!!taskId} onOpenChange={(open) => !open && onClose()} title="Задача">
      {!task ? (
        <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
          {error ?? "Загрузка…"}
        </div>
      ) : (
        <>
          {/* Кнопки шапки на телефоне крупнее: 28 px мышью попадаются, пальцем — нет. */}
          <SheetHeader className="border-b border-border px-4 py-3">
            <div className="flex items-center gap-2">
              <Button
                variant={isDone ? "secondary" : "outline"}
                size="sm"
                className="h-9 sm:h-7"
                onClick={() => {
                  const target = isDone ? reopenStatus() : doneStatus;
                  if (target) void patch({ status_id: target.id });
                }}
              >
                <CheckCircle2 className={cn("size-4", isDone && "text-emerald-500")} />
                {isDone ? "Завершена" : "Завершить"}
              </Button>
              <span className="flex-1" />
              <Button
                variant="outline"
                size="sm"
                className="h-9 sm:h-7"
                onClick={() => void startTimerHere()}
                title="Начать отсчёт времени по этой задаче"
              >
                <Play className="size-4" />
                Таймер
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                className="size-9 sm:size-7"
                onClick={() => void toggleFollow()}
                title={amFollower ? "Не следить" : "Следить"}
              >
                {amFollower ? <BellOff className="size-4" /> : <Bell className="size-4" />}
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                className="size-9 sm:size-7"
                onClick={() => void removeTask()}
                title="Удалить"
              >
                <Trash2 className="size-4" />
              </Button>
              <Button variant="ghost" size="icon-sm" className="size-9 sm:size-7" onClick={onClose}>
                <X className="size-4" />
              </Button>
            </div>
          </SheetHeader>

          <div className="flex-1 overflow-y-auto">
            <div className="flex flex-col gap-4 px-4 py-4">
              {error && <p className="text-sm text-destructive">{error}</p>}

              <Input
                key={`title-${task.id}`}
                defaultValue={task.title}
                className="border-none px-0 text-lg font-semibold shadow-none focus-visible:ring-0"
                onBlur={(e) => {
                  const v = e.target.value.trim();
                  if (v && v !== task.title) void patch({ title: v });
                }}
              />

              <div className="grid grid-cols-[110px_1fr] items-center gap-x-3 gap-y-2.5 text-sm">
                <span className="text-muted-foreground">Статус</span>
                <Select
                  value={task.status_id ?? ""}
                  onValueChange={(v) => v && void patch({ status_id: v })}
                >
                  <SelectTrigger size="sm" className="w-fit min-w-36">
                    <SelectValue placeholder="Без статуса">
                      <StatusPill status={statuses.find((s) => s.id === task.status_id)} />
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
                  value={task.priority}
                  onValueChange={(v) => v && void patch({ priority: v as TaskPriority })}
                >
                  <SelectTrigger size="sm" className="w-fit min-w-36">
                    <SelectValue>{PRIORITY_LABELS[task.priority].label}</SelectValue>
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
                    value={task.due_date ?? ""}
                    onChange={(e) => void patch({ due_date: e.target.value || null })}
                    className="rounded-md border border-border bg-background px-2 py-1 text-sm"
                  />
                  <input
                    type="time"
                    value={task.due_time?.slice(0, 5) ?? ""}
                    onChange={(e) => void patch({ due_time: e.target.value || null })}
                    className="rounded-md border border-border bg-background px-2 py-1 text-sm"
                  />
                </div>

                <span className="text-muted-foreground">Исполнители</span>
                <div className="flex flex-wrap items-center gap-1.5">
                  {task.assignees.map((a) => (
                    <span key={a.id} className="inline-flex items-center gap-1 rounded-full bg-muted py-0.5 pl-0.5 pr-2 text-xs">
                      <Avatar user={a} size="xs" />
                      {a.name || a.email}
                      <button
                        className="text-muted-foreground hover:text-foreground"
                        onClick={() =>
                          void setAssignees(task.assignees.filter((x) => x.id !== a.id).map((x) => x.id))
                        }
                      >
                        <X className="size-3" />
                      </button>
                    </span>
                  ))}
                  <MemberPicker selected={task.assignees} onChange={(ids) => void setAssignees(ids)} />
                </div>

                <span className="text-muted-foreground">Теги</span>
                <div className="flex flex-wrap items-center gap-1.5">
                  {tags.map((t) => {
                    const active = task.tags.some((x) => x.id === t.id);
                    return (
                      <button
                        key={t.id}
                        onClick={() => {
                          const next = active
                            ? task.tags.filter((x) => x.id !== t.id).map((x) => x.id)
                            : [...task.tags.map((x) => x.id), t.id];
                          void patch({ tag_ids: next });
                        }}
                        className={cn(
                          "rounded-full px-2 py-0.5 text-[11px] font-medium transition-opacity",
                          active ? "" : "opacity-40 hover:opacity-80",
                        )}
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
                  {task.placements.map((pl) => {
                    const project = projects.find((p) => p.id === pl.project_id);
                    return (
                      <span key={pl.project_id} className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2 py-0.5 text-xs">
                        <span className="size-2 rounded-sm" style={{ backgroundColor: project?.color ?? "#6b7280" }} />
                        {project?.name ?? "Недоступный проект"}
                        <button
                          className="text-muted-foreground hover:text-foreground"
                          onClick={() =>
                            void setPlacements(task.placements.filter((x) => x.project_id !== pl.project_id).map((x) => x.project_id))
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
                      if (v) void setPlacements([...task.placements.map((p) => p.project_id), v]);
                    }}
                  >
                    <SelectTrigger size="sm" className="h-6 w-fit border-dashed text-xs text-muted-foreground">
                      <Plus className="size-3" /> В проект
                    </SelectTrigger>
                    <SelectContent>
                      {projects
                        .filter(
                          (p) =>
                            !task.placements.some((pl) => pl.project_id === p.id) &&
                            (p.my_role === "admin" || p.my_role === "editor"),
                        )
                        .map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.name}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>

                {visibleFields.map((f) => (
                  <FieldRow
                    key={f.id}
                    field={f}
                    value={task.field_values[f.id]}
                    onChange={(v) => void setFieldValue(f.id, v)}
                  />
                ))}
              </div>

              <RichText
                key={`desc-${task.id}`}
                value={task.description}
                onSave={(html) => void patch({ description: html })}
              />

              <div>
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Подзадачи
                </p>
                <div className="flex flex-col gap-1">
                  {subtasks.map((s) => (
                    <div key={s.id} className="flex items-center gap-2 rounded-md px-1 py-0.5 hover:bg-muted/50">
                      <button onClick={() => void toggleSubtaskDone(s)}>
                        {s.completed_at ? (
                          <CheckCircle2 className="size-4 text-emerald-500" />
                        ) : (
                          <Circle className="size-4 text-muted-foreground" />
                        )}
                      </button>
                      <span className={cn("flex-1 text-sm", s.completed_at && "text-muted-foreground line-through")}>
                        {s.title}
                      </span>
                    </div>
                  ))}
                  <div className="flex items-center gap-2">
                    <Plus className="size-4 text-muted-foreground" />
                    <input
                      value={subtaskTitle}
                      onChange={(e) => setSubtaskTitle(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && void addSubtask()}
                      placeholder="Добавить подзадачу…"
                      className="flex-1 bg-transparent py-1 text-sm outline-none placeholder:text-muted-foreground"
                    />
                  </div>
                </div>
              </div>

              <RelationsList
                entityType="task"
                entityId={task.id}
                canEdit={canEdit}
                initialRelations={relations}
                initialTypes={relationTypes}
              />
            </div>

            <div className="border-t border-border">
              <div className="flex gap-1 px-4 pt-3">
                {(["comments", "feed"] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => setTab(t)}
                    className={cn(
                      "rounded-lg px-3 py-1 text-sm",
                      tab === t ? "bg-muted font-medium" : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {t === "comments" ? `Комментарии (${comments.length})` : "История"}
                  </button>
                ))}
              </div>
              <div className="flex flex-col gap-3 px-4 py-3">
                {tab === "comments" ? (
                  <>
                    {comments.map((c) => (
                      <div key={c.id} className="flex gap-2">
                        {c.author ? <Avatar user={c.author} size="sm" /> : <span className="size-6" />}
                        <div className="min-w-0 flex-1">
                          <p className="text-xs text-muted-foreground">
                            <span className="font-medium text-foreground">
                              {c.author?.name || c.author?.email || c.author_label || "Неизвестный"}
                            </span>{" "}
                            · {new Date(c.created_at).toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                            {c.edited_at && " · изменён"}
                          </p>
                          <div
                            className="prose prose-sm dark:prose-invert max-w-none text-sm"
                            dangerouslySetInnerHTML={{ __html: c.body }}
                          />
                        </div>
                      </div>
                    ))}
                    <div className="flex gap-2">
                      {me && <Avatar user={me} size="sm" />}
                      <div className="flex-1">
                        <Textarea
                          value={commentText}
                          onChange={(e) => setCommentText(e.target.value)}
                          placeholder="Написать комментарий…"
                          className="min-h-16 text-sm"
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void addComment();
                          }}
                        />
                        <div className="mt-1.5 flex justify-end">
                          <Button size="sm" onClick={() => void addComment()} disabled={!commentText.trim()}>
                            Отправить
                          </Button>
                        </div>
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="flex flex-col gap-2">
                    {feed.map((e) => (
                      <p key={e.id} className="text-xs text-muted-foreground">
                        <span className="font-medium text-foreground">
                          {e.actor?.name || e.actor?.email || "Система"}
                        </span>{" "}
                        {eventLabel(e)} ·{" "}
                        {new Date(e.created_at).toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                      </p>
                    ))}
                    {feed.length === 0 && <p className="text-xs text-muted-foreground">Пока пусто</p>}
                  </div>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </SidePanel>
  );
}

function FieldRow({
  field,
  value,
  onChange,
}: {
  field: CustomField;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const { members } = useV2Store();
  return (
    <>
      <span className="truncate text-muted-foreground" title={field.name}>
        {field.name}
      </span>
      <div>
        {field.type === "text" && (
          <Input
            defaultValue={typeof value === "string" ? value : ""}
            className="h-7 text-sm"
            onBlur={(e) => onChange(e.target.value || null)}
          />
        )}
        {field.type === "number" && (
          <Input
            type="number"
            defaultValue={typeof value === "number" ? String(value) : ""}
            className="h-7 w-32 text-sm"
            onBlur={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
          />
        )}
        {field.type === "date" && (
          <input
            type="date"
            value={typeof value === "string" ? value : ""}
            onChange={(e) => onChange(e.target.value || null)}
            className="rounded-md border border-border bg-background px-2 py-1 text-sm"
          />
        )}
        {field.type === "checkbox" && (
          <input
            type="checkbox"
            checked={value === true}
            onChange={(e) => onChange(e.target.checked)}
            className="size-4 accent-primary"
          />
        )}
        {field.type === "url" && (
          <Input
            defaultValue={typeof value === "string" ? value : ""}
            placeholder="https://…"
            className="h-7 text-sm"
            onBlur={(e) => onChange(e.target.value || null)}
          />
        )}
        {field.type === "select" && (
          <Select value={typeof value === "string" ? value : ""} onValueChange={(v) => onChange(v || null)}>
            <SelectTrigger size="sm" className="w-fit min-w-32">
              <SelectValue placeholder="—">
                {field.options.find((o) => o.id === value)?.label ?? "—"}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {field.options.map((o) => (
                <SelectItem key={o.id} value={o.id}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {field.type === "multi_select" && (
          <div className="flex flex-wrap gap-1">
            {field.options.map((o) => {
              const arr = Array.isArray(value) ? (value as string[]) : [];
              const active = arr.includes(o.id);
              return (
                <button
                  key={o.id}
                  onClick={() => onChange(active ? arr.filter((x) => x !== o.id) : [...arr, o.id])}
                  className={cn(
                    "rounded-full border px-2 py-0.5 text-[11px]",
                    active ? "border-primary bg-muted font-medium" : "border-border text-muted-foreground",
                  )}
                >
                  {o.label}
                </button>
              );
            })}
          </div>
        )}
        {field.type === "user" && (
          <Select value={typeof value === "string" ? value : ""} onValueChange={(v) => onChange(v || null)}>
            <SelectTrigger size="sm" className="w-fit min-w-36">
              <SelectValue placeholder="—">
                {(() => {
                  const m = members.find((x) => x.user_id === value);
                  return m ? m.name || m.email : "—";
                })()}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {members.map((m) => (
                <SelectItem key={m.user_id} value={m.user_id}>
                  {m.name || m.email}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>
    </>
  );
}

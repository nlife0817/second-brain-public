"use client";

// Карточка задачи: поля, исполнители, проекты (multi-homing), кастомные поля,
// подзадачи, комментарии и лента активности. Сохранение — по действию (PATCH).

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Bell,
  BellOff,
  Calendar,
  Check,
  CheckCircle2,
  Clock,
  CornerLeftUp,
  Link2,
  Play,
  Plus,
  Square,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SheetHeader } from "@/components/ui/sheet";
import { formatEstimate } from "@/components/v2/tasks/cells";
import {
  ESTIMATE_POPOVER,
  EstimateForm,
  PRIORITY_ORDER,
} from "@/components/v2/tasks/draft-controls";
import { SegmentedPicker } from "@/components/v2/tasks/SegmentedPicker";
import { SubtaskSection } from "@/components/v2/tasks/SubtaskSection";
import { api } from "@/lib/core/client";
import { cardStatuses } from "@/lib/core/status-model";
import type { TaskChange } from "@/lib/core/task-change";
import { createTaskFromDraft, type TaskDraft } from "@/lib/core/task-draft";
import type {
  CoreComment,
  CoreEvent,
  CustomField,
  DocCommentThread,
  RelationType,
  RelationWithTarget,
  TaskDetail,
  TaskPriority,
  TaskListItem,
} from "@/lib/core/types";
import { useV2Store, useV2StoreApi, type ActiveTimer } from "@/lib/core/ui-store";
import { useLoad } from "@/lib/core/use-load";
import { useTaskOpenStore } from "@/lib/core/view-store";
import { cn } from "@/lib/utils";
import { Avatar, PRIORITY_LABELS, chipStyle, dueTone, formatDue } from "./bits";
import { DuePicker } from "./DuePicker";
import { MemberPicker } from "./MemberPicker";
import { RelationsList } from "./RelationsList";
import { SidePanel, useWideViewport } from "./SidePanel";
import { TaskRecurrence, type TaskRecurrenceRule } from "./TaskRecurrence";
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
// Полноэкранный документ — отдельный чанк поверх того же Tiptap: развёрнутый
// режим открывают заметно реже, чем карточку.
const DocEditor = dynamic(() => import("./editor/DocEditor").then((m) => m.DocEditor), {
  ssr: false,
});
// Композер комментария — тот же Tiptap, что и редактор описания, поэтому и он
// приезжает отдельным чанком: карточку открывают и ради одного взгляда на срок.
const CommentComposer = dynamic(
  () => import("./editor/CommentComposer").then((m) => m.CommentComposer),
  {
    ssr: false,
    loading: () => (
      <div className="min-h-9 rounded-lg border border-input px-3 py-2 text-sm text-muted-foreground">
        Написать комментарий…
      </div>
    ),
  },
);

/**
 * Высота поля названия по содержимому. Ref-колбэк, а не эффект: правило
 * `set-state-in-effect` считает нарушением любую правку состояния в эффекте, а
 * здесь состояния и нет — только стиль узла, который уже в DOM.
 */
function autoGrow(el: HTMLTextAreaElement | null) {
  if (!el) return;
  el.style.height = "auto";
  el.style.height = `${el.scrollHeight}px`;
}

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
  "doc_comment.added": "начал(а) обсуждение в описании",
  "doc_comment.replied": "ответил(а) в обсуждении описания",
  "doc_comment.resolved": "закрыл(а) обсуждение описания",
  "doc_comment.reopened": "переоткрыл(а) обсуждение описания",
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

/**
 * Чип и кнопка в сетке свойств. Высоту держит `h-7` — тот же рост, что у полей
 * и селектов карточки; вертикальные паддинги при ней не нужны. Раньше каждый ряд
 * набирал свою высоту паддингами (проекты 20 px, теги 24, исполнители 26), и
 * значения в соседних строках не стояли на одной линии.
 */
const PROP_CHIP = "inline-flex h-7 items-center gap-1.5 text-xs";

/** Родитель подзадачи — ровно то, что нужно хлебной крошке. */
interface ParentBrief {
  id: string;
  title: string;
  completed_at: string | null;
}

/** Ответ /tasks/:id/bundle — всё содержимое карточки за один запрос. */
interface TaskBundle {
  task: TaskDetail;
  comments: CoreComment[];
  feed: CoreEvent[];
  subtasks: TaskListItem[];
  parent: ParentBrief | null;
  relations: RelationWithTarget[];
  relation_types: RelationType[];
  recurrence: TaskRecurrenceRule | null;
  doc_comments: DocCommentThread[];
}

export function TaskSheet({
  taskId: rootTaskId,
  onClose,
  onChanged,
}: {
  taskId: string | null;
  onClose: () => void;
  onChanged?: (change: TaskChange) => void;
}) {
  // Подзадача — такая же задача, и правится она в такой же карточке: клик по
  // ней открывает её в этой же панели, «Назад» возвращает к предыдущей.
  //
  // Стек помнит, от какой задачи он отсчитан: пришёл новый `rootTaskId` — стек
  // считается пустым сам собой, без сброса состояния в эффекте (тот вызвал бы
  // лишний ре-рендер и запрещён правилом react-hooks/set-state-in-effect).
  const [nav, setNav] = useState<{ root: string | null; ids: string[] }>({ root: null, ids: [] });
  const stack = nav.root === rootTaskId ? nav.ids : [];
  const taskId = stack.length > 0 ? stack[stack.length - 1] : rootTaskId;

  const openNested = useCallback(
    (id: string) => {
      setNav((prev) => ({
        root: rootTaskId,
        ids: [...(prev.root === rootTaskId ? prev.ids : []), id],
      }));
    },
    [rootTaskId],
  );

  const goBack = useCallback(() => {
    setNav((prev) => ({
      root: rootTaskId,
      ids: (prev.root === rootTaskId ? prev.ids : []).slice(0, -1),
    }));
  }, [rootTaskId]);

  /** Закрытие панели обнуляет и навигацию: следующее открытие — с корня. */
  const closeSheet = useCallback(() => {
    setNav({ root: null, ids: [] });
    onClose();
  }, [onClose]);

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
  const [parent, setParent] = useState<ParentBrief | null>(null);
  const [relations, setRelations] = useState<RelationWithTarget[]>([]);
  const [relationTypes, setRelationTypes] = useState<RelationType[]>([]);
  const [recurrence, setRecurrence] = useState<TaskRecurrenceRule | null>(null);
  const [docThreads, setDocThreads] = useState<DocCommentThread[]>([]);
  // Разворот помнится по задаче, а не флагом: иначе переход к соседней задаче
  // оставлял бы открытым документ уже другой — сбрасывать это в эффекте
  // означало бы лишний каскад перерисовок.
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);
  const [tab, setTab] = useState<"comments" | "feed">("comments");
  /** Корень обсуждения, в который уйдёт следующий комментарий; null — в ленту. */
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Тихое «Сохранено ✓» в шапке: blur сохраняет молча, и без подтверждения
  // непонятно, ушла ли правка на сервер.
  const [saved, setSaved] = useState(false);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flashSaved = useCallback(() => {
    setSaved(true);
    if (savedTimer.current) clearTimeout(savedTimer.current);
    savedTimer.current = setTimeout(() => setSaved(false), 1400);
  }, []);
  useEffect(() => () => {
    if (savedTimer.current) clearTimeout(savedTimer.current);
  }, []);

  // Ссылка на задачу. Копируем адрес роута /v2/tasks/<id>, а не текущий URL:
  // тот зависит от того, откуда карточку открыли, и после пересылки увёл бы
  // получателя на чужой экран (или на «Мои задачи», где этой задачи нет).
  const [linkCopied, setLinkCopied] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (copiedTimer.current) clearTimeout(copiedTimer.current);
  }, []);

  const copyLink = useCallback(async () => {
    if (!taskId) return;
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/v2/tasks/${taskId}`);
      setLinkCopied(true);
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
      copiedTimer.current = setTimeout(() => setLinkCopied(false), 1600);
    } catch {
      // Буфер обмена закрыт настройками браузера — молчать нельзя, иначе
      // кнопка выглядит сработавшей.
      setError("Не удалось скопировать ссылку — браузер не дал доступ к буферу обмена");
    }
  }, [taskId]);

  // Раскладка: в широком модальном окне свойства уходят в правую колонку —
  // описание и обсуждение получают всю ширину. Панель остаётся одноколоночной.
  const openMode = useTaskOpenStore((s) => s.mode);
  const wideViewport = useWideViewport();
  const twoCol = openMode === "modal" && wideViewport;

  // Живой таймер в шапке: если глобальный таймер тикает по этой задаче,
  // кнопка «Таймер» превращается в бегущий счётчик со стопом.
  const activeTimer = useV2Store((s) => s.activeTimer);
  const timerHere = activeTimer && !activeTimer.ended_at && activeTimer.task_id === taskId ? activeTimer : null;
  const [timerNow, setTimerNow] = useState(() => Date.now());
  useEffect(() => {
    if (!timerHere) return;
    // Первое значение придёт по тику: синхронный setState в эффекте запускает
    // каскадный ре-рендер (react-hooks/set-state-in-effect), а секунда
    // задержки на старте счётчика незаметна.
    const t = setInterval(() => setTimerNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [timerHere]);

  // Быстрое переключение задач: ответ по прежней задаче не должен перетереть текущую.
  const currentTaskRef = useRef<string | null>(null);

  // Зеркало задачи для обработчиков. Считать новое состояние внутри апдейтера
  // `setTask` нельзя: апдейтер исполняется в фазе рендера, и вызванный оттуда
  // `onChanged` правит экран за панелью прямо во время её отрисовки (React
  // ругается «Cannot update a component while rendering a different one»).
  // Замыкание тоже не подходит: между запросом и ответом состояние уходит вперёд.
  const taskRef = useRef<TaskDetail | null>(null);
  useEffect(() => {
    taskRef.current = task;
  }, [task]);

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
      setParent(b.parent ?? null);
      setRelations(b.relations);
      setRelationTypes(b.relation_types);
      setRecurrence(b.recurrence ?? null);
      setDocThreads(b.doc_comments ?? []);
      setError(null);
    } catch (e) {
      if (currentTaskRef.current !== taskId) return;
      setError(e instanceof Error ? e.message : "Не удалось загрузить задачу");
    }
    // setTask — псевдоним setLoaded, ссылка стабильна; в списке он только
    // потому, что через `const` правило этого не видит.
  }, [orgId, taskId, setTask]);

  // Отметку «какую задачу ждём» ставим до запроса: по ней ответ прежней задачи
  // отсекается, если пользователь уже переключился на следующую.
  const loadTask = useCallback(() => {
    currentTaskRef.current = taskId;
    if (taskId) return load();
  }, [taskId, load]);
  useLoad(loadTask);

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
    if ("estimated_minutes" in body) {
      next.estimated_minutes = body.estimated_minutes as number | null;
    }
    if (typeof body.status_id === "string") {
      next.status_id = body.status_id;
      const category = statuses.find((s) => s.id === body.status_id)?.category;
      // Снимает метку любая категория кроме `done`, а не только «рабочая»:
      // ровно так считает сервер (`becameDone`) и таблица (`applyLocal`).
      // Проверка на «открытый» пропускала архив — карточка мигала ответом.
      if (category === "done") next.completed_at = prev.completed_at ?? new Date().toISOString();
      else if (category) next.completed_at = null;
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
      flashSaved();
    } catch (e) {
      if (currentTaskRef.current !== taskId) return;
      setTask(previous);
      onChanged?.({ type: "patched", task: previous, confirmed: true });
      setError(e instanceof Error ? e.message : "Не удалось выполнить действие");
    }
  }

  /**
   * Разметка приходит из редактора: комментарии набирают в нём, потому что в них
   * живут @-упоминания. Ручная свёртка текста в <p> съедала бы их.
   *
   * `parentId` — корень обсуждения; ответ на ответ сервер приведёт к тому же
   * корню, поэтому здесь достаточно передать, на что нажали.
   */
  async function addComment(html: string, parentId: string | null = null) {
    if (!orgId || !taskId) return;
    await run(async () => {
      const comment = await api.post<CoreComment>(`/orgs/${orgId}/tasks/${taskId}/comments`, {
        body: html,
        parent_id: parentId,
      });
      if (currentTaskRef.current !== taskId) return;
      // Ответ встаёт за последним ответом своего корня, а не в конец ленты:
      // иначе он прыгнет на место после первой же перезагрузки карточки.
      setComments((prev) => {
        if (!comment.parent_id) return [...prev, comment];
        const last = prev.findLastIndex(
          (c) => c.id === comment.parent_id || c.parent_id === comment.parent_id,
        );
        if (last < 0) return [...prev, comment];
        return [...prev.slice(0, last + 1), comment, ...prev.slice(last + 1)];
      });
      setReplyTo(null);
      // Композер закреплён внизу и виден из обеих вкладок — отправка из
      // «Истории» должна показать, куда упал комментарий.
      setTab("comments");
      flashSaved();
      // Через зеркало, а не апдейтером: см. комментарий к taskRef.
      const current = taskRef.current;
      if (current) {
        const next = { ...current, comment_count: current.comment_count + 1 };
        setTask(next);
        onChanged?.({ type: "patched", task: next, confirmed: true });
      }
    });
  }

  /**
   * Счётчики подзадач у родителя — их показывает и колонка списка.
   *
   * `confirmed` отмечает предсказание: пока правка не подтверждена сервером,
   * экран не должен вешать на неё побочную работу (перечит кэша, счётчики
   * сайдбара) — иначе каждое действие уходит в сеть дважды.
   */
  function bumpSubtaskCounters(deltaTotal: number, deltaDone: number, confirmed = true) {
    const prev = taskRef.current;
    if (!prev) return;
    const next: TaskDetail = {
      ...prev,
      subtask_count: prev.subtask_count + deltaTotal,
      subtask_done_count: prev.subtask_done_count + deltaDone,
    };
    // Ref обновляем сразу: два вызова подряд (правка и откат) иначе посчитались
    // бы от одного и того же состояния, и дельта потерялась бы.
    taskRef.current = next;
    setTask(next);
    onChanged?.({ type: "patched", task: next, confirmed });
  }

  /**
   * Создание подзадачи из черновика — тем же путём, что и обычной задачи в
   * «Все задачи»: вместе с кастомными полями, отказ по которым остаётся
   * предупреждением (задача уже создана).
   */
  async function addSubtask(draft: TaskDraft) {
    if (!orgId || !taskId) return;
    // Ошибку наверх не глушим: её показывает сама строка добавления, а
    // черновик при этом остаётся набранным.
    const { task: created, fieldsWarning } = await createTaskFromDraft(orgId, draft, {
      parent_task_id: taskId,
    });
    if (currentTaskRef.current !== taskId) return;
    setSubtasks((prev) => [...prev, created]);
    bumpSubtaskCounters(1, created.completed_at ? 1 : 0);
    setError(fieldsWarning);
    // В списках экрана появилась новая задача — их надо перечитать.
    onChanged?.({ type: "reload" });
  }

  async function deleteSubtask(sub: TaskListItem) {
    if (!orgId) return;
    // У подзадачи могут быть свои подзадачи, а внешний ключ каскадный: молча
    // унести с собой целую ветку нельзя.
    const branch =
      sub.subtask_count > 0 ? ` вместе с её подзадачами (${sub.subtask_count})` : "";
    if (!window.confirm(`Удалить подзадачу «${sub.title}»${branch} безвозвратно?`)) return;
    const previous = subtasks;
    setSubtasks((prev) => prev.filter((s) => s.id !== sub.id));
    bumpSubtaskCounters(-1, sub.completed_at ? -1 : 0, false);
    try {
      await api.del(`/orgs/${orgId}/tasks/${sub.id}`);
      onChanged?.({ type: "deleted", taskId: sub.id });
      setError(null);
    } catch (e) {
      setSubtasks(previous);
      bumpSubtaskCounters(1, sub.completed_at ? 1 : 0);
      setError(e instanceof Error ? e.message : "Не удалось удалить подзадачу");
    }
  }

  /** Отвязка от родителя: подзадача становится обычной задачей и остаётся жить. */
  async function detachSubtask(sub: TaskListItem) {
    if (!orgId) return;
    const previous = subtasks;
    setSubtasks((prev) => prev.filter((s) => s.id !== sub.id));
    bumpSubtaskCounters(-1, sub.completed_at ? -1 : 0, false);
    try {
      const updated = await api.patch<TaskDetail>(`/orgs/${orgId}/tasks/${sub.id}`, {
        parent_task_id: null,
      });
      onChanged?.({ type: "patched", task: updated, confirmed: true });
      setError(null);
    } catch (e) {
      setSubtasks(previous);
      bumpSubtaskCounters(1, sub.completed_at ? 1 : 0);
      setError(e instanceof Error ? e.message : "Не удалось отвязать подзадачу");
    }
  }

  async function toggleSubtaskDone(sub: TaskListItem) {
    if (!orgId) return;
    const doneStatus = statuses.find((s) => s.category === "done");
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
    bumpSubtaskCounters(0, wasDone ? -1 : 1, false);
    try {
      await api.patch(`/orgs/${orgId}/tasks/${sub.id}`, { status_id: target.id });
      setError(null);
    } catch (e) {
      setSubtasks(previous);
      bumpSubtaskCounters(0, wasDone ? 1 : -1);
      setError(e instanceof Error ? e.message : "Не удалось выполнить действие");
    }
  }

  /**
   * Предсказание для строки подзадачи. Правила те же, что у таблицы
   * (`applyLocal` в `TaskTableView`) и у сервера: метку завершения снимает
   * любой статус не вида `done`.
   */
  function previewSubtask(prev: TaskListItem, body: Record<string, unknown>): TaskListItem {
    const { members } = storeApi.getState();
    const next: TaskListItem = { ...prev };
    for (const [key, value] of Object.entries(body)) {
      if (key === "assignee_ids") {
        const ids = new Set(value as string[]);
        next.assignees = members
          .filter((m) => ids.has(m.user_id))
          .map((m) => ({ id: m.user_id, email: m.email, name: m.name, avatar_url: m.avatar_url }));
      } else {
        (next as unknown as Record<string, unknown>)[key] = value;
      }
    }
    if ("status_id" in body) {
      const category = statuses.find((s) => s.id === body.status_id)?.category;
      if (category === "done" && !prev.completed_at) next.completed_at = new Date().toISOString();
      if (category && category !== "done" && prev.completed_at) next.completed_at = null;
    }
    return next;
  }

  /**
   * Правка поля подзадачи прямо в её строке — не открывая карточку. Счётчики
   * родителя двигаем только когда метка завершения действительно поменялась:
   * иначе колонка «Подзадачи» в списке за карточкой начнёт врать.
   */
  async function patchSubtask(sub: TaskListItem, body: Record<string, unknown>) {
    if (!orgId) return;
    const previous = subtasks;
    const optimistic = previewSubtask(sub, body);
    const deltaDone = (optimistic.completed_at ? 1 : 0) - (sub.completed_at ? 1 : 0);
    setSubtasks((prev) => prev.map((s) => (s.id === sub.id ? optimistic : s)));
    if (deltaDone !== 0) bumpSubtaskCounters(0, deltaDone, false);
    try {
      const updated = await api.patch<TaskDetail>(`/orgs/${orgId}/tasks/${sub.id}`, body);
      if (currentTaskRef.current !== taskId) return;
      setSubtasks((prev) => prev.map((s) => (s.id === sub.id ? { ...s, ...updated } : s)));
      // Строка подзадачи живёт и в списке за карточкой — отдаём ей ответ сервера.
      onChanged?.({ type: "patched", task: updated, confirmed: true });
      setError(null);
    } catch (e) {
      setSubtasks(previous);
      if (deltaDone !== 0) bumpSubtaskCounters(0, -deltaDone);
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
      flashSaved();
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
      flashSaved();
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
      // Удалили подзадачу, открытую изнутри родителя, — возвращаемся к нему, а
      // не закрываем всю панель: карточка родителя перечитается и потеряет строку.
      if (stack.length > 0) goBack();
      else closeSheet();
    });
  }

  /**
   * Куда возвращать задачу, если снимают отметку «завершена»: в последний
   * рабочий статус перед «Готово», а не в самый первый («Входящие») — иначе
   * снятая галочка отбрасывает задачу в начало процесса.
   */
  function reopenStatus() {
    const working = statuses.filter((s) => s.category === "backlog" || s.category === "in_progress");
    return working.length > 0 ? working[working.length - 1] : undefined;
  }

  /** Учёт времени начинается там, где идёт работа — в карточке задачи. */
  async function startTimerHere() {
    if (!orgId || !taskId) return;
    await run(async () => {
      await api.post(`/orgs/${orgId}/time/timer`, { task_id: taskId });
      // Свежее состояние — в стор: счётчик в шапке и глобальный виджет
      // должны затикать сразу, а не после минутной сверки.
      const res = await api.get<{ active: ActiveTimer | null }>(`/orgs/${orgId}/time/timer`);
      storeApi.getState().setActiveTimer(res.active);
      setError(null);
    });
  }

  async function stopTimerHere() {
    if (!orgId) return;
    await run(async () => {
      await api.del(`/orgs/${orgId}/time/timer`);
      storeApi.getState().setActiveTimer(null);
      setError(null);
    });
  }

  /** Секунды таймера → «м:сс» или «ч:мм:сс» — как в глобальном виджете. */
  function formatElapsed(seconds: number): string {
    const s = Math.max(0, Math.floor(seconds));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const pad = (n: number) => String(n).padStart(2, "0");
    return h > 0 ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`;
  }

  /** На сколько дней просрочен срок; 0 — не просрочен. */
  function overdueDaysOf(date: string | null): number {
    if (!date) return 0;
    const [y, m, d] = date.split("-").map(Number);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const diff = Math.round((today.getTime() - new Date(y, m - 1, d).getTime()) / 86_400_000);
    return diff > 0 ? diff : 0;
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

  const doneStatus = statuses.find((s) => s.category === "done");
  const isDone = !!task?.completed_at;
  const visibleFields = fields.filter(
    (f) => !f.project_id || task?.placements.some((p) => p.project_id === f.project_id),
  );

  /**
   * Черновик подзадачи начинается с проектов родителя: без размещения задача
   * уходит в личный инбокс и пропадает из списков проекта, внутри задачи
   * которого её только что завели. Проекты, где нет прав на создание, не
   * подставляем — сервер отказал бы всей форме, а не отдельному размещению.
   *
   * Срок не наследуем: у подзадач он свой, а «сегодня» из общего черновика в
   * карточке только мешает — большинство подзадач заводят вообще без срока.
   */
  const subtaskDefaults = useMemo<Partial<TaskDraft>>(
    () => ({
      project_ids: (task?.placements ?? [])
        .filter((pl) =>
          projects.some(
            (p) =>
              p.id === pl.project_id &&
              !p.archived_at &&
              (p.my_role === "admin" || p.my_role === "editor"),
          ),
        )
        .map((pl) => pl.project_id),
      due_date: null,
    }),
    [task?.placements, projects],
  );

  // Развёрнутое описание закрывает экран целиком, и карточка под ним не нужна.
  // Дело не в красоте: оболочка карточки — модальный диалог (панель или окно,
  // см. SidePanel), она забирает фокус себе и объявляет всё вне себя скрытым
  // для скринридера. Оставить её открытой значит держать поверх неё слой, до
  // которого не добраться ни клавиатурой, ни озвучкой. Состояние карточки живёт
  // в этом компоненте и переживает закрытие оболочки — возврат ничего не
  // перечитывает.
  const docOpen = !!task && expandedTaskId === task.id;

  // Сетка свойств. В панели — «метка · значение» в две колонки, в широкой
  // модалке она уезжает в правую колонку и метки встают над значениями.
  const propLabel = twoCol
    ? "mt-3 truncate text-[11px] font-semibold uppercase tracking-wide text-muted-foreground first:mt-0"
    : "truncate text-muted-foreground";
  const dueText = task ? formatDue(task.due_date, task.due_time) : null;
  const overdueDays = task && !isDone ? overdueDaysOf(task.due_date) : 0;
  const dueLabelContent = task && (
    <>
      <Calendar className={cn("size-4 shrink-0", overdueDays > 0 ? "text-destructive" : "text-muted-foreground")} />
      {dueText ? (
        <span className={cn("tabular-nums", dueTone(task.due_date, isDone))}>{dueText}</span>
      ) : (
        <span className="text-muted-foreground">Указать срок</span>
      )}
      {overdueDays > 0 && (
        <span className="shrink-0 rounded-full bg-destructive/10 px-1.5 text-[10px] font-semibold leading-5 text-destructive">
          просрочено {overdueDays} дн.
        </span>
      )}
    </>
  );
  /**
   * Статус и приоритет — ряды кнопок во всю ширину под заголовком, а не строки
   * в сетке свойств: это самые частые действия в карточке, и прятать их в
   * выпадающий список значит два клика вместо одного каждый раз.
   *
   * Архивные статусы в ряд не входят (архивирование — не следующий шаг работы),
   * кроме случая, когда задача уже в архиве: иначе из него было бы не выйти.
   */
  const flowRows = task && (
    <div className="flex flex-col gap-1.5">
      <SegmentedPicker
        ariaLabel="Статус задачи"
        options={cardStatuses(statuses, task.status_id).map((s) => ({
          value: s.id,
          label: s.name,
          color: s.color,
        }))}
        value={task.status_id}
        disabled={!canEdit}
        onChange={(id) => void patch({ status_id: id })}
      />
      <SegmentedPicker
        ariaLabel="Приоритет задачи"
        options={PRIORITY_ORDER.map((p) => ({
          value: p,
          label: PRIORITY_LABELS[p].label,
          dotClass: PRIORITY_LABELS[p].dot,
        }))}
        value={task.priority}
        disabled={!canEdit}
        onChange={(p) => void patch({ priority: p })}
      />
    </div>
  );

  const propsGrid = task && (
    <div
      className={cn(
        "text-sm",
        twoCol
          ? "grid grid-cols-1 items-start gap-y-1"
          : "grid grid-cols-[110px_1fr] items-center gap-x-3 gap-y-2.5",
      )}
    >
      {/* Статуса и приоритета здесь больше нет: они переехали под заголовок
          задачи рядами кнопок (`flowRows`). Два способа поменять одно и то же
          поле — это два места, которые разъедутся. */}
      <span className={propLabel}>Срок</span>
      {canEdit ? (
        // Календарь с быстрыми датами и временем вместо двух нативных полей;
        // просрочка видна прямо у значения.
        <DuePicker
          date={task.due_date}
          time={task.due_time}
          triggerClassName="-ml-2 flex h-7 w-fit max-w-full items-center gap-2 rounded-lg border border-transparent px-2 text-sm transition-colors hover:border-input hover:bg-background"
          onCommit={(next) => void patch(next)}
        >
          {dueLabelContent}
        </DuePicker>
      ) : (
        <span className="flex items-center gap-2">{dueLabelContent}</span>
      )}

      {/* Оценку правит и таблица, и черновик, и строка подзадачи — а в самой
          карточке её не было вовсе. */}
      <span className={propLabel}>Оценка</span>
      {canEdit ? (
        <Popover>
          <PopoverTrigger
            render={
              <button
                className="-ml-2 flex w-fit max-w-full items-center gap-2 rounded-lg border border-transparent px-2 py-1 text-sm transition-colors hover:border-input hover:bg-background"
                title="Оценка"
              />
            }
          >
            <Clock className="size-4 shrink-0 text-muted-foreground" />
            {task.estimated_minutes != null ? (
              <span className="tabular-nums">{formatEstimate(task.estimated_minutes)}</span>
            ) : (
              <span className="text-muted-foreground">Указать оценку</span>
            )}
          </PopoverTrigger>
          <PopoverContent align="start" className={ESTIMATE_POPOVER}>
            <EstimateForm
              value={task.estimated_minutes}
              onChange={(estimated_minutes) => void patch({ estimated_minutes })}
            />
          </PopoverContent>
        </Popover>
      ) : (
        <span className="flex items-center gap-2">
          <Clock className="size-4 shrink-0 text-muted-foreground" />
          {task.estimated_minutes != null ? (
            <span className="tabular-nums">{formatEstimate(task.estimated_minutes)}</span>
          ) : (
            <span className="text-muted-foreground">Не задана</span>
          )}
        </span>
      )}

      {/* Повтор — свойство самой задачи: отдельного экрана правил больше нет,
          копия рождается из её текущего состояния. */}
      <span className={propLabel}>Повтор</span>
      <TaskRecurrence
        orgId={orgId}
        taskId={task.id}
        rule={recurrence}
        canEdit={canEdit}
        onChange={setRecurrence}
      />

      <span className={propLabel}>Исполнители</span>
      {/* Кнопку «Назначить» рисует MemberPicker, общий на несколько экранов:
          свой рост она задаёт паддингом внутри себя, и в ряду с чипами
          получалась на пару пикселей выше. Правим здесь, чтобы не менять
          плотность пикера там, где он стоит один. */}
      <div className="flex flex-wrap items-center gap-1.5 [&>button]:h-7 [&>button]:py-0">
        {task.assignees.map((a) => (
          <span
            key={a.id}
            className={cn(PROP_CHIP, "rounded-full border border-border bg-card pl-0.5 pr-2 shadow-xs")}
          >
            <Avatar user={a} size="xs" />
            {a.name || a.email}
            <button
              className="text-muted-foreground hover:text-destructive"
              title="Снять исполнителя"
              onClick={() =>
                void setAssignees(task.assignees.filter((x) => x.id !== a.id).map((x) => x.id))
              }
            >
              <X className="size-3" />
            </button>
          </span>
        ))}
        <MemberPicker
          selected={task.assignees}
          // Цепочка, а не свои размещения: подзадача наследует
          // проекты родителя вместе с их закрытостью.
          projectIds={task.chain_project_ids}
          onChange={(ids) => void setAssignees(ids)}
        />
      </div>

      <span className={propLabel}>Теги</span>
      <div className="flex flex-wrap items-center gap-1.5">
        {/* Только надетые теги: полный список организации разом превращал
            карточку в кашу. Добавление — через «+ тег». */}
        {task.tags.map((t) => (
          <span
            key={t.id}
            className={cn(PROP_CHIP, "tinted-chip gap-1 rounded-full px-2 text-[11px] font-medium")}
            style={chipStyle(t.color)}
          >
            {t.name}
            {canEdit && (
              <button
                className="opacity-55 transition-opacity hover:opacity-100"
                title="Снять тег"
                onClick={() =>
                  void patch({ tag_ids: task.tags.filter((x) => x.id !== t.id).map((x) => x.id) })
                }
              >
                <X className="size-3" />
              </button>
            )}
          </span>
        ))}
        {canEdit && (
          <Popover>
            <PopoverTrigger
              render={
                <button
                  className={cn(
                    PROP_CHIP,
                    "gap-1 rounded-full border border-dashed border-border px-2 text-muted-foreground transition-colors hover:border-primary hover:bg-primary/10 hover:text-primary",
                  )}
                  title="Добавить тег"
                />
              }
            >
              <Plus className="size-3" /> тег
            </PopoverTrigger>
            <PopoverContent align="start" className="max-h-72 w-56 overflow-y-auto p-1">
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
                    className="flex w-full items-center gap-2 rounded px-2 py-1 text-sm hover:bg-muted"
                  >
                    <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: t.color }} />
                    <span className="flex-1 truncate text-left">{t.name}</span>
                    {active && <Check className="size-3.5 shrink-0" />}
                  </button>
                );
              })}
              {tags.length === 0 && (
                <p className="px-2 py-1.5 text-xs text-muted-foreground">Тегов пока нет</p>
              )}
            </PopoverContent>
          </Popover>
        )}
        {!canEdit && task.tags.length === 0 && (
          <span className="text-xs text-muted-foreground">Нет тегов</span>
        )}
      </div>

      <span className={propLabel}>Проекты</span>
      <div className="flex flex-wrap items-center gap-1.5">
        {task.placements.map((pl) => {
          const project = projects.find((p) => p.id === pl.project_id);
          return (
            <span key={pl.project_id} className={cn(PROP_CHIP, "rounded-full bg-muted px-2")}>
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
          <SelectTrigger size="sm" className="w-fit border-dashed text-xs text-muted-foreground">
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
          labelClassName={propLabel}
          value={task.field_values[f.id]}
          onChange={(v) => void setFieldValue(f.id, v)}
        />
      ))}
    </div>
  );

  return (
    <>
    <SidePanel
      open={!!rootTaskId && !docOpen}
      onOpenChange={(open) => !open && !docOpen && closeSheet()}
      title="Задача"
    >
      {!task ? (
        <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
          {error ?? "Загрузка…"}
        </div>
      ) : (
        <>
          {/* Кнопки шапки на телефоне крупнее: 28 px мышью попадаются, пальцем — нет. */}
          <SheetHeader className="border-b border-border px-4 py-3">
            <div className="flex items-center gap-2">
              {/* Открыли подзадачу изнутри карточки — «Назад» возвращает к ней. */}
              {stack.length > 0 && (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="size-9 sm:size-7"
                  onClick={goBack}
                  title="Назад"
                >
                  <ArrowLeft className="size-4" />
                </Button>
              )}
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
              <span
                aria-live="polite"
                className={cn(
                  "flex items-center gap-1 text-[11px] font-semibold text-emerald-600 transition-opacity duration-300",
                  saved ? "opacity-100" : "opacity-0",
                )}
              >
                <Check className="size-3" />
                Сохранено
              </span>
              <span className="flex-1" />
              {timerHere ? (
                <Button
                  variant="secondary"
                  size="sm"
                  className="h-9 gap-1.5 font-mono text-xs tabular-nums text-primary sm:h-7"
                  onClick={() => void stopTimerHere()}
                  title="Остановить таймер"
                >
                  <Square className="size-3 fill-current" />
                  {formatElapsed((timerNow - new Date(timerHere.started_at).getTime()) / 1000)}
                </Button>
              ) : (
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
              )}
              <Button
                variant="ghost"
                size="icon-sm"
                className="size-9 sm:size-7"
                onClick={() => void copyLink()}
                title={linkCopied ? "Ссылка скопирована" : "Скопировать ссылку на задачу"}
                aria-label="Скопировать ссылку на задачу"
              >
                {linkCopied ? <Check className="size-4 text-emerald-500" /> : <Link2 className="size-4" />}
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
              <Button variant="ghost" size="icon-sm" className="size-9 sm:size-7" onClick={closeSheet}>
                <X className="size-4" />
              </Button>
            </div>
          </SheetHeader>

          <div className="flex-1 overflow-y-auto">
            <div className={cn(twoCol && "grid min-h-full grid-cols-[minmax(0,1fr)_272px] items-stretch")}>
            <div className="flex min-w-0 flex-col gap-4 px-4 py-4">
              {error && <p className="text-sm text-destructive">{error}</p>}

              {/* Карточку подзадачи открывают и напрямую — из списка, поиска или
                  пуша: без этой строки непонятно, частью чего она является. */}
              {parent && (
                <button
                  onClick={() => openNested(parent.id)}
                  className="flex max-w-full items-center gap-1 self-start text-xs text-muted-foreground hover:text-foreground"
                  title="Открыть родительскую задачу"
                >
                  <CornerLeftUp className="size-3.5 shrink-0" />
                  <span className="truncate">{parent.title}</span>
                </button>
              )}

              {/* Textarea, а не Input: длинное название в поле ввода уезжает за
                  правый край без единого признака, что текст продолжается.
                  Высота подгоняется по содержимому, Enter не переносит строку —
                  название однострочное по смыслу, перенос только визуальный. */}
              <textarea
                key={`title-${task.id}`}
                ref={autoGrow}
                rows={1}
                defaultValue={task.title}
                onInput={(e) => autoGrow(e.currentTarget)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    e.currentTarget.blur();
                  }
                }}
                className="resize-none border-none bg-transparent p-0 font-heading text-lg font-semibold leading-snug tracking-tight outline-none"
                onBlur={(e) => {
                  const v = e.target.value.trim();
                  if (v && v !== task.title) void patch({ title: v });
                  else if (!v) e.target.value = task.title;
                }}
              />

              {flowRows}

              {!twoCol && propsGrid}

              {/* Оболочка карточки остаётся смонтированной и закрытой, поэтому
                  редактор карточки надо снимать явно: два живых редактора на
                  одном описании наперегонки сохраняют его каждый своей версией. */}
              {!docOpen && (
                <RichText
                  key={`desc-${task.id}`}
                  value={task.description}
                  onSave={(html) => void patch({ description: html })}
                  orgId={orgId}
                  taskId={task.id}
                  editable={canEdit}
                  onExpand={() => setExpandedTaskId(task.id)}
                  threadCount={docThreads.filter((t) => !t.resolved_at).length}
                  collapsible
                />
              )}

              <SubtaskSection
                subtasks={subtasks}
                canEdit={canEdit}
                defaults={subtaskDefaults}
                chainProjectIds={task.chain_project_ids}
                onCreate={addSubtask}
                onToggleDone={(s) => void toggleSubtaskDone(s)}
                onOpen={openNested}
                onPatch={(s, body) => void patchSubtask(s, body)}
                onDelete={(s) => void deleteSubtask(s)}
                onDetach={(s) => void detachSubtask(s)}
              />

              <RelationsList
                entityType="task"
                entityId={task.id}
                canEdit={canEdit}
                initialRelations={relations}
                initialTypes={relationTypes}
              />

              <div className="border-t border-border pt-3">
                <div className="flex gap-1">
                  {(["comments", "feed"] as const).map((t) => (
                    <button
                      key={t}
                      onClick={() => setTab(t)}
                      className={cn(
                        "rounded-lg px-3 py-1 text-sm",
                        tab === t
                          ? "bg-primary/10 font-medium text-primary"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {t === "comments" ? `Комментарии (${comments.length})` : "История"}
                    </button>
                  ))}
                </div>
                <div className="flex flex-col gap-3 py-3">
                  {tab === "comments" ? (
                    <>
                      {comments.map((c) => (
                        // Ответы сдвинуты и отчёркнуты слева: иерархия ровно
                        // одноуровневая, ответ на ответ сервер приводит к тому
                        // же корню — дерево в узкой колонке нечитаемо.
                        <div key={c.id} className={cn("flex gap-2", c.parent_id && "ml-8 border-l border-border pl-3")}>
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
                            {orgRole !== null && replyTo !== (c.parent_id ?? c.id) && (
                              <button
                                onClick={() => setReplyTo(c.parent_id ?? c.id)}
                                className="mt-0.5 text-[11px] text-muted-foreground hover:text-foreground"
                              >
                                Ответить
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                      {comments.length === 0 && (
                        <p className="text-xs text-muted-foreground">Комментариев пока нет</p>
                      )}
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

            {/* Широкая модалка: свойства — в правой колонке на тонированной
                подложке, как в Linear; контент получает всю ширину. */}
            {twoCol && (
              <aside className="border-l border-border bg-muted/40 px-4 py-4">{propsGrid}</aside>
            )}
            </div>
          </div>

          {/* Композер закреплён внизу карточки: комментарий пишется без
              прокрутки через всю задачу. Право комментировать проверяет
              сервер — гостю оно доступно по роли в проекте. */}
          {orgRole !== null && (
            <div className="shrink-0 border-t border-border bg-background px-4 py-2.5">
              <div className="flex items-start gap-2">
                {me && <Avatar user={me} size="sm" />}
                <div className="min-w-0 flex-1">
                  {replyTo && (
                    <p className="mb-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                      Ответ в обсуждении
                      <button onClick={() => setReplyTo(null)} className="underline hover:text-foreground">
                        отменить
                      </button>
                    </p>
                  )}
                  <CommentComposer
                    // key переводит композер в чистое состояние при смене задачи
                    // и при переходе «новый комментарий ↔ ответ».
                    key={`${taskId}-${replyTo ?? "root"}`}
                    placeholder={replyTo ? "Ответить…" : "Написать комментарий…"}
                    onSubmit={(html) => addComment(html, replyTo)}
                  />
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </SidePanel>

    {task && docOpen && (
      <DocEditor
        open
        onClose={() => setExpandedTaskId(null)}
        orgId={orgId}
        taskId={task.id}
        taskTitle={task.title}
        value={task.description}
        onSave={(html) => void patch({ description: html })}
        editable={canEdit}
        // Право комментировать проверяет сервер: у гостя оно зависит от роли в
        // конкретном проекте, а её карточка не знает.
        canComment={orgRole !== null}
        canResolveAll={canEdit}
        me={me}
        initialThreads={docThreads}
      />
    )}
    </>
  );
}

function FieldRow({
  field,
  value,
  onChange,
  labelClassName,
}: {
  field: CustomField;
  value: unknown;
  onChange: (value: unknown) => void;
  /** Класс метки задаёт карточка: в панели и в колонке модалки он разный. */
  labelClassName?: string;
}) {
  const { members } = useV2Store();
  return (
    <>
      <span className={labelClassName ?? "truncate text-muted-foreground"} title={field.name}>
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
            className="h-7 rounded-md border border-border bg-background px-2 text-sm"
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
                    PROP_CHIP,
                    "rounded-full border px-2 text-[11px]",
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

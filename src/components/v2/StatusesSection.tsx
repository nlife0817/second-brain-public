"use client";

// Справочник статусов в настройках организации: правка уже заведённых статусов —
// название, цвет, порядок и категория, — плюс добавление и удаление.
//
// Раздел вынесен из SettingsClient отдельным компонентом: перетаскивание держит
// своё состояние и меряет строки, и внутри экрана на девятьсот строк это
// нечитаемо.
//
// Правила справочника — в `status-model.ts`, и проверяются они здесь теми же
// чистыми функциями, что и на сервере: перетаскивание, которое оставит
// «Бэклог» пустым, не должно уходить в сеть, чтобы вернуться 422.

import { useRef, useState } from "react";
import { GripVertical, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { api } from "@/lib/core/client";
import {
  CATEGORY_LABELS,
  STATUS_CATEGORIES,
  arrangementError,
  deleteBlockMessage,
  fallbackStatusId,
  groupByCategory,
  isWorkingCategory,
  statusDeleteBlock,
} from "@/lib/core/status-model";
import type { StatusCategory, TaskStatus } from "@/lib/core/types";
import { useV2Store, useV2StoreApi } from "@/lib/core/ui-store";
import { cn } from "@/lib/utils";
// Палитра общая с проектами: один набор цветов на приложение, иначе статус и
// проект одного «синего» оказываются разными синими.
import { PROJECT_COLORS } from "./project-icons";

const CATEGORY_HINTS: Partial<Record<StatusCategory, string>> = {
  done: "проставляет отметку о завершении",
  archived: "может пустовать; в карточке задачи такие статусы не показываются",
};

/** Куда встанет статус при отпускании: категория и место среди её строк. */
interface DropTarget {
  category: StatusCategory;
  index: number;
}

interface StatusDrag {
  id: string;
  /** Насколько увели палец от места нажатия. */
  dy: number;
  target: DropTarget;
}

/** Обмеренная категория: её полоса на экране и середины её строк. */
interface Zone {
  category: StatusCategory;
  top: number;
  bottom: number;
  rows: Array<{ id: string; mid: number }>;
}

export function StatusesSection({
  canManage,
  onError,
}: {
  canManage: boolean;
  onError: (message: string | null) => void;
}) {
  const store = useV2Store();
  const storeApi = useV2StoreApi();
  const { orgId, statuses } = store;

  // Своё поле на категорию: одна строка ввода на весь справочник не даёт
  // выбрать, куда именно добавляется статус.
  const [adding, setAdding] = useState<Partial<Record<StatusCategory, string>>>({});
  const [drag, setDrag] = useState<StatusDrag | null>(null);
  // Зеркало состояния для обработчиков: события указателя приходят пачками, и
  // читать из них замыкание рендера — значит терять те, что пришли до перерисовки.
  const dragRef = useRef<StatusDrag | null>(null);
  const grabbedAt = useRef(0);
  const zones = useRef<Zone[]>([]);
  const rowRefs = useRef(new Map<string, HTMLElement>());
  const zoneRefs = useRef(new Map<StatusCategory, HTMLElement>());

  const groups = groupByCategory(statuses);
  /** Справочник в порядке категорий — он же порядок, который уедет на сервер. */
  const flat = groups.flatMap((g) => g.statuses);

  function setDragState(next: StatusDrag | null) {
    dragRef.current = next;
    setDrag(next);
  }

  async function call(fn: () => Promise<unknown>) {
    try {
      await fn();
      onError(null);
    } catch (e) {
      onError(e instanceof Error ? e.message : "Ошибка");
    }
  }

  /** Правка одного статуса: сначала на экране, потом на сервере, с откатом. */
  async function patchStatus(id: string, patch: Partial<TaskStatus> & { is_default?: true }) {
    const snapshot = storeApi.getState().statuses;
    const optimistic = snapshot.map((s) =>
      s.id === id
        ? { ...s, ...patch }
        : // Дефолт один на организацию: не снять флаг у прежнего значит показать
          // два «по умолчанию» до следующей загрузки.
          patch.is_default
          ? { ...s, is_default: false }
          : s,
    );
    storeApi.getState().setStatuses(optimistic);
    try {
      const row = await api.patch<TaskStatus>(`/orgs/${orgId}/statuses/${id}`, patch);
      const current = storeApi.getState().statuses;
      storeApi.getState().setStatuses(
        current.map((s) =>
          s.id === row.id ? row : patch.is_default ? { ...s, is_default: false } : s,
        ),
      );
      onError(null);
    } catch (e) {
      storeApi.getState().setStatuses(snapshot);
      onError(e instanceof Error ? e.message : "Ошибка");
    }
  }

  function rename(status: TaskStatus, value: string) {
    const name = value.trim();
    // Пустое имя — не правка, а промах: возвращаем прежнее и молчим.
    if (!name || name === status.name) return;
    void patchStatus(status.id, { name });
  }

  // --- Порядок -------------------------------------------------------------------

  /**
   * Новая раскладка по перестановке: статус вынимается из своей категории и
   * встаёт в целевую. Позиции нормализуются в 1..N — так глобальный порядок
   * совпадает с порядком категорий, а ряд кнопок в карточке задачи (он идёт по
   * позиции) не перемешивает категории.
   */
  function arrange(id: string, target: DropTarget): TaskStatus[] | null {
    const moved = statuses.find((s) => s.id === id);
    if (!moved) return null;
    const next: TaskStatus[] = [];
    for (const category of STATUS_CATEGORIES) {
      const rest = statuses.filter((s) => s.category === category && s.id !== id);
      const withMoved =
        category === target.category
          ? [
              ...rest.slice(0, target.index),
              { ...moved, category },
              ...rest.slice(target.index),
            ]
          : rest;
      next.push(...withMoved);
    }
    return next.map((s, i) => ({ ...s, position: i + 1 }));
  }

  function sameOrder(next: TaskStatus[]): boolean {
    return next.every((s, i) => flat[i]?.id === s.id && flat[i]?.category === s.category);
  }

  async function commitOrder(next: TaskStatus[]) {
    const invalid = arrangementError(next);
    if (invalid) {
      onError(invalid);
      return;
    }
    const snapshot = storeApi.getState().statuses;
    storeApi.getState().setStatuses(next);
    try {
      const rows = await api.put<TaskStatus[]>(`/orgs/${orgId}/statuses/order`, {
        order: next.map((s) => ({ id: s.id, category: s.category })),
      });
      storeApi.getState().setStatuses(rows);
      onError(null);
    } catch (e) {
      storeApi.getState().setStatuses(snapshot);
      onError(e instanceof Error ? e.message : "Ошибка");
    }
  }

  /** Где статус стоит сейчас — в тех же координатах, что и цель перетаскивания. */
  function slotOf(id: string): DropTarget {
    const status = statuses.find((s) => s.id === id)!;
    const inCategory = statuses.filter((s) => s.category === status.category);
    return { category: status.category, index: inCategory.findIndex((s) => s.id === id) };
  }

  function beginDrag(e: React.PointerEvent<HTMLButtonElement>, id: string) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    // Захват указателя обязателен: без него палец, ушедший с ручки, перестаёт
    // слать события. Отказ (указатель уже отпущен) не повод ронять обработчик.
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* перетаскивание всё равно отработает, пока курсор над ручкой */
    }
    grabbedAt.current = e.clientY;
    // Меряем один раз на нажатие: строки во время перетаскивания не переезжают
    // (сдвигать соседей через категории с заголовками нечитаемо — вместо этого
    // рисуем полосу вставки), поэтому и обмер остаётся верным до отпускания.
    zones.current = STATUS_CATEGORIES.map((category) => {
      const box = zoneRefs.current.get(category)?.getBoundingClientRect();
      return {
        category,
        top: box?.top ?? 0,
        bottom: box?.bottom ?? 0,
        rows: statuses
          .filter((s) => s.category === category && s.id !== id)
          .map((s) => {
            const rect = rowRefs.current.get(s.id)?.getBoundingClientRect();
            return { id: s.id, mid: rect ? rect.top + rect.height / 2 : 0 };
          }),
      };
    });
    setDragState({ id, dy: 0, target: slotOf(id) });
  }

  function trackDrag(e: React.PointerEvent<HTMLButtonElement>) {
    const current = dragRef.current;
    if (!current) return;
    const y = e.clientY;
    // Ближайшая категория, а не только та, в чью полосу попал палец: между
    // блоками есть отступ, и в нём цель не должна улетать в конец справочника.
    const zone = zones.current.reduce<Zone | null>((best, z) => {
      const distance = y < z.top ? z.top - y : y > z.bottom ? y - z.bottom : 0;
      const bestDistance =
        best === null ? Infinity : y < best.top ? best.top - y : y > best.bottom ? y - best.bottom : 0;
      return distance < bestDistance ? z : best;
    }, null);
    if (!zone) return;
    const index = zone.rows.filter((r) => r.mid < y).length;
    setDragState({
      ...current,
      dy: y - grabbedAt.current,
      target: { category: zone.category, index },
    });
  }

  function endDrag() {
    const current = dragRef.current;
    setDragState(null);
    if (!current) return;
    const next = arrange(current.id, current.target);
    if (!next || sameOrder(next)) return;
    void commitOrder(next);
  }

  /** Клавиатурная перестановка: шаг по общему порядку, в том числе через категорию. */
  function moveByKey(id: string, delta: number) {
    const from = flat.findIndex((s) => s.id === id);
    const neighbour = flat[from + delta];
    if (from < 0 || !neighbour) return;
    const target: DropTarget =
      neighbour.category === flat[from].category
        ? { category: neighbour.category, index: slotOf(id).index + delta }
        : // В чужую категорию встаём краем, к которому подошли: вверх — в конец
          // предыдущей, вниз — в начало следующей.
          {
            category: neighbour.category,
            index: delta < 0 ? statuses.filter((s) => s.category === neighbour.category).length : 0,
          };
    const next = arrange(id, target);
    if (!next || sameOrder(next)) return;
    void commitOrder(next);
  }

  async function addStatus(category: StatusCategory) {
    const name = (adding[category] ?? "").trim();
    if (!name) return;
    await call(async () => {
      await api.post(`/orgs/${orgId}/statuses`, { name, category });
      setAdding((prev) => ({ ...prev, [category]: "" }));
      await store.refreshMeta();
    });
  }

  return (
    <div className="flex select-none flex-col gap-4">
      {groups.map(({ category, statuses: inCategory }) => {
        const rest = inCategory.filter((s) => s.id !== drag?.id);
        const indicatorAt =
          drag && drag.target.category === category ? drag.target.index : null;
        return (
          <div
            key={category}
            ref={(el) => {
              if (el) zoneRefs.current.set(category, el);
              else zoneRefs.current.delete(category);
            }}
            className="flex flex-col gap-1.5"
          >
            <div className="flex items-baseline gap-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {CATEGORY_LABELS[category]}
              </span>
              <span className="text-[11px] text-muted-foreground/70">
                {CATEGORY_HINTS[category] ?? ""}
              </span>
            </div>

            <div className="relative flex flex-col">
              {/* Полоса вставки в пустой категории: без неё непонятно, что архив
                  вообще принимает статусы. */}
              {indicatorAt !== null && rest.length === 0 && <DropLine />}
              {inCategory.map((s) => {
                const dragging = drag?.id === s.id;
                const before = indicatorAt !== null && rest[indicatorAt]?.id === s.id;
                return (
                  <div key={s.id}>
                    {before && <DropLine />}
                    <StatusRow
                      status={s}
                      statuses={statuses}
                      canManage={canManage}
                      dragging={dragging}
                      dy={dragging ? drag.dy : 0}
                      rowRef={(el) => {
                        if (el) rowRefs.current.set(s.id, el);
                        else rowRefs.current.delete(s.id);
                      }}
                      onBeginDrag={(e) => beginDrag(e, s.id)}
                      onTrackDrag={trackDrag}
                      onEndDrag={endDrag}
                      onCancelDrag={() => setDragState(null)}
                      onMoveByKey={(delta) => moveByKey(s.id, delta)}
                      onRename={(value) => rename(s, value)}
                      onColor={(color) => void patchStatus(s.id, { color })}
                      onMakeDefault={() => void patchStatus(s.id, { is_default: true })}
                      onDelete={() =>
                        void call(async () => {
                          await api.del(`/orgs/${orgId}/statuses/${s.id}`);
                          await store.refreshMeta();
                        })
                      }
                    />
                  </div>
                );
              })}
              {indicatorAt !== null && rest.length > 0 && indicatorAt >= rest.length && <DropLine />}
            </div>

            {canManage && (
              <div className="flex items-center gap-2">
                <Input
                  placeholder={`Новый статус в «${CATEGORY_LABELS[category]}»`}
                  value={adding[category] ?? ""}
                  onChange={(e) => setAdding((prev) => ({ ...prev, [category]: e.target.value }))}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void addStatus(category);
                  }}
                  className="h-8 w-64"
                />
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!(adding[category] ?? "").trim()}
                  onClick={() => void addStatus(category)}
                >
                  Добавить
                </Button>
              </div>
            )}
          </div>
        );
      })}

      {canManage && (
        <p className="text-[11px] text-muted-foreground">
          Порядок — перетаскиванием за ручку слева (или ↑/↓ на ней); перетаскивание в другую
          категорию меняет и категорию. Название правится на месте, цвет — кружком.
        </p>
      )}
    </div>
  );
}

function DropLine() {
  return <div className="pointer-events-none -my-px h-0.5 rounded-full bg-primary" />;
}

function StatusRow({
  status,
  statuses,
  canManage,
  dragging,
  dy,
  rowRef,
  onBeginDrag,
  onTrackDrag,
  onEndDrag,
  onCancelDrag,
  onMoveByKey,
  onRename,
  onColor,
  onMakeDefault,
  onDelete,
}: {
  status: TaskStatus;
  statuses: TaskStatus[];
  canManage: boolean;
  dragging: boolean;
  dy: number;
  rowRef: (el: HTMLDivElement | null) => void;
  onBeginDrag: (e: React.PointerEvent<HTMLButtonElement>) => void;
  onTrackDrag: (e: React.PointerEvent<HTMLButtonElement>) => void;
  onEndDrag: () => void;
  onCancelDrag: () => void;
  onMoveByKey: (delta: number) => void;
  onRename: (value: string) => void;
  onColor: (color: string) => void;
  onMakeDefault: () => void;
  onDelete: () => void;
}) {
  const block = statusDeleteBlock(statuses, status.id);
  const fallback = statuses.find((s) => s.id === fallbackStatusId(statuses, status.id));

  return (
    <div
      ref={rowRef}
      style={{ transform: `translate3d(0, ${dy}px, 0)`, zIndex: dragging ? 10 : undefined }}
      className={cn(
        "relative flex h-9 items-center gap-2 rounded-md px-1",
        dragging && "bg-background shadow-md ring-1 ring-ring",
      )}
    >
      {canManage ? (
        <button
          onPointerDown={onBeginDrag}
          onPointerMove={onTrackDrag}
          onPointerUp={onEndDrag}
          onPointerCancel={onCancelDrag}
          onKeyDown={(e) => {
            if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
            e.preventDefault();
            onMoveByKey(e.key === "ArrowUp" ? -1 : 1);
          }}
          // touch-none обязателен: без него палец прокручивает страницу вместо
          // перетаскивания.
          className={cn(
            "shrink-0 touch-none rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground",
            dragging ? "cursor-grabbing" : "cursor-grab",
          )}
          title="Перетащите, чтобы изменить порядок или категорию (или ↑/↓)"
          aria-label={`Переместить статус «${status.name}»`}
        >
          <GripVertical className="size-3.5" />
        </button>
      ) : (
        <span className="size-4 shrink-0" />
      )}

      {canManage ? (
        <Popover>
          <PopoverTrigger
            render={
              <button
                className="size-3.5 shrink-0 rounded-full ring-offset-2 ring-offset-background hover:ring-2 hover:ring-ring"
                style={{ backgroundColor: status.color }}
                title="Цвет статуса"
                aria-label={`Цвет статуса «${status.name}»`}
              />
            }
          />
          <PopoverContent align="start" className="w-auto">
            <div className="flex flex-wrap items-center gap-2">
              {PROJECT_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => onColor(c)}
                  aria-label={`Цвет ${c}`}
                  className={cn(
                    "size-6 rounded-full transition-transform",
                    status.color === c &&
                      "scale-110 ring-2 ring-ring ring-offset-2 ring-offset-background",
                  )}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </PopoverContent>
        </Popover>
      ) : (
        <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: status.color }} />
      )}

      {canManage ? (
        <NameInput name={status.name} onCommit={onRename} />
      ) : (
        <span className="min-w-0 flex-1 truncate text-sm">{status.name}</span>
      )}

      {status.is_default && (
        <span className="shrink-0 rounded bg-primary/10 px-1.5 py-0.5 text-[11px] font-medium text-primary">
          по умолчанию
        </span>
      )}
      {canManage && !status.is_default && isWorkingCategory(status.category) && (
        <Button
          variant="ghost"
          size="xs"
          className="shrink-0 text-xs text-muted-foreground"
          title="Новые задачи будут попадать в этот статус"
          onClick={onMakeDefault}
        >
          Сделать основным
        </Button>
      )}
      {canManage && (
        // Кнопка не исчезает, а гаснет с объяснением: пропавшая кнопка читается
        // как поломка, а не как правило.
        <Button
          variant="ghost"
          size="icon-xs"
          className="shrink-0"
          disabled={!!block}
          title={block ? deleteBlockMessage(block, status.category) : "Удалить статус"}
          onClick={() => {
            const where = fallback ? `«${fallback.name}»` : "статус по умолчанию";
            if (window.confirm(`Удалить статус «${status.name}»? Задачи переедут в ${where}.`)) {
              onDelete();
            }
          }}
        >
          <Trash2 className="size-3.5" />
        </Button>
      )}
    </div>
  );
}

/**
 * Название правится на месте: сохраняем по Enter и по потере фокуса, Escape
 * возвращает прежнее. Черновик живёт в самом поле, поэтому чужая правка (или
 * откат неудачной) видна сразу — состояние сбрасывается ключом снаружи.
 */
function NameInput({ name, onCommit }: { name: string; onCommit: (value: string) => void }) {
  // Запомненное имя лежит в самом состоянии, а не в ref: сравнение с ним идёт в
  // рендере, а читать ref в рендере правило не разрешает — и по делу.
  const [draft, setDraft] = useState({ name, value: name });

  // Имя изменилось не нами (ответ сервера, откат, другая организация) — берём его.
  if (draft.name !== name) setDraft({ name, value: name });

  return (
    <Input
      value={draft.value}
      onChange={(e) => setDraft({ name, value: e.target.value })}
      onBlur={() => {
        if (!draft.value.trim()) setDraft({ name, value: name });
        onCommit(draft.value);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          setDraft({ name, value: name });
          e.currentTarget.blur();
        }
      }}
      className="h-7 min-w-0 flex-1 border-transparent bg-transparent px-1.5 hover:border-input"
    />
  );
}

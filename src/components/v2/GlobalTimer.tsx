"use client";

// Плавающий виджет активного таймера — виден на всех экранах v2, как
// GlobalTimerWidget в v1. Без него человек уходит со страницы «Время» и
// забывает, что таймер тикает.
//
// Простой определяется на клиенте: сервер о вкладке ничего не знает, а
// заводить ради этого heartbeat-эндпоинт и колонку в БД дорого. Когда
// возвращаешься после долгого отсутствия, виджет предлагает вычесть паузу —
// правка сдвигает начало записи вперёд.

import { useCallback, useEffect, useRef, useState } from "react";
import { Clock3, Loader2, Square, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/core/client";
import { useV2Store } from "@/lib/core/ui-store";
import { cn } from "@/lib/utils";

interface ActiveTimer {
  id: string;
  task_id: string | null;
  started_at: string;
  ended_at: string | null;
  note: string;
  task_title: string | null;
}

/** С какой паузы предлагать вычесть простой. Короткие отлучки — не простой. */
const IDLE_THRESHOLD_MS = 5 * 60_000;
/** Как часто проверяем активность и сверяем таймер с сервером. */
const TICK_MS = 1_000;
const SYNC_MS = 60_000;

function formatElapsed(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

export function GlobalTimer() {
  const orgId = useV2Store((s) => s.orgId);
  const [timer, setTimer] = useState<ActiveTimer | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  /**
   * Замеченная пауза, на которую пользователь ещё не ответил. Именно
   * «защёлкнутое» значение, а не текущее время бездействия: вопрос «вас не
   * было N минут» должен пережить возвращение к компьютеру — иначе первое же
   * движение мыши стёрло бы повод его задать.
   */
  const [pendingIdleMs, setPendingIdleMs] = useState(0);

  // Момент последней активности живёт в ref: обновлять состояние на каждое
  // движение мыши — это ре-рендер на каждое движение мыши.
  const lastActivity = useRef(Date.now());

  const sync = useCallback(async () => {
    if (!orgId) return;
    try {
      setTimer(await api.get<ActiveTimer | null>(`/orgs/${orgId}/time/timer`));
    } catch {
      // Виджет фоновый: сеть мигнула — просто ждём следующей сверки.
    }
  }, [orgId]);

  useEffect(() => {
    void sync();
    const t = setInterval(() => void sync(), SYNC_MS);
    return () => clearInterval(t);
  }, [sync]);

  /**
   * Активность — только настоящее действие руками. `focus` и
   * `visibilitychange` сюда не входят: они срабатывают при возвращении во
   * вкладку и обнулили бы паузу ровно в тот момент, когда о ней надо спросить.
   */
  useEffect(() => {
    const mark = () => {
      const away = Date.now() - lastActivity.current;
      lastActivity.current = Date.now();
      // Возврат после долгого отсутствия: защёлкиваем паузу до ответа.
      if (away >= IDLE_THRESHOLD_MS) setPendingIdleMs((prev) => Math.max(prev, away));
    };
    const events: (keyof WindowEventMap)[] = ["pointerdown", "keydown", "wheel"];
    for (const e of events) window.addEventListener(e, mark, { passive: true });
    return () => {
      for (const e of events) window.removeEventListener(e, mark);
    };
  }, []);

  useEffect(() => {
    if (!timer) return;
    const t = setInterval(() => {
      const current = Date.now();
      setNow(current);
      // Пока человека нет, счётчик паузы растёт и в фоне: интервал в скрытой
      // вкладке душится браузером, но время меряется по часам, а не по тикам.
      const away = current - lastActivity.current;
      if (away >= IDLE_THRESHOLD_MS) setPendingIdleMs((prev) => Math.max(prev, away));
    }, TICK_MS);
    return () => clearInterval(t);
  }, [timer]);

  const stop = useCallback(async () => {
    if (!orgId) return;
    setBusy(true);
    try {
      await api.del(`/orgs/${orgId}/time/timer`);
      setTimer(null);
    } finally {
      setBusy(false);
    }
  }, [orgId]);

  /** Вычесть простой: начало записи сдвигается вперёд на длительность паузы. */
  const discardIdle = useCallback(async () => {
    if (!orgId || !timer) return;
    setBusy(true);
    try {
      const shifted = new Date(new Date(timer.started_at).getTime() + pendingIdleMs);
      // Пауза длиннее самой записи: вычитать больше, чем натикало, нельзя —
      // сервер отвергнет старт в будущем. Сбрасываем счётчик в ноль.
      const capped = shifted.getTime() > Date.now() ? new Date() : shifted;
      const updated = await api.patch<ActiveTimer>(`/orgs/${orgId}/time/${timer.id}`, {
        started_at: capped.toISOString(),
      });
      setTimer((prev) => (prev ? { ...prev, started_at: updated.started_at } : prev));
      lastActivity.current = Date.now();
      setPendingIdleMs(0);
    } finally {
      setBusy(false);
    }
  }, [orgId, timer, pendingIdleMs]);

  if (!timer) return null;

  const elapsed = (now - new Date(timer.started_at).getTime()) / 1000;
  const showIdle = pendingIdleMs >= IDLE_THRESHOLD_MS;

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex flex-col items-end gap-2">
      {showIdle && (
        <div className="pointer-events-auto flex max-w-xs items-start gap-2 rounded-xl border border-amber-500/40 bg-background p-3 shadow-lg">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium">Вас не было {Math.round(pendingIdleMs / 60000)} мин</p>
            <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">
              Таймер всё это время шёл. Вычесть паузу из записи?
            </p>
            <div className="mt-1.5 flex gap-1.5">
              <Button size="xs" disabled={busy} onClick={() => void discardIdle()}>
                Вычесть
              </Button>
              <Button size="xs" variant="ghost" onClick={() => setPendingIdleMs(0)}>
                Оставить
              </Button>
            </div>
          </div>
          <button
            onClick={() => setPendingIdleMs(0)}
            className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground"
            title="Закрыть"
          >
            <X className="size-3.5" />
          </button>
        </div>
      )}

      <div className="pointer-events-auto flex items-center gap-2 rounded-full border border-border bg-background py-1.5 pl-3 pr-1.5 shadow-lg">
        <Clock3 className={cn("size-3.5 shrink-0", showIdle ? "text-amber-500" : "text-emerald-500")} />
        <span className="font-mono text-sm tabular-nums">{formatElapsed(elapsed)}</span>
        <span className="max-w-[10rem] truncate text-xs text-muted-foreground">
          {timer.task_title ?? timer.note ?? "Без задачи"}
        </span>
        <Button
          size="icon-xs"
          variant="ghost"
          disabled={busy}
          onClick={() => void stop()}
          title="Остановить таймер"
          className="rounded-full hover:text-destructive"
        >
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Square className="size-3.5" />}
        </Button>
      </div>
    </div>
  );
}

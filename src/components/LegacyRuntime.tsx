"use client";

// Фоновая обвязка интерфейса v1: провайдер тайм-трекинга и его виджеты.
// Собрана в один модуль, чтобы LegacyRuntimeGate мог грузить её отдельным
// чанком и только там, где она нужна.
//
// Realtime-подписки здесь больше нет: она работала через Supabase Realtime,
// которого после переезда на собственный VPS нет, а v1 заморожена (см.
// docs/VPS-MIGRATION.md, §7). Экраны v1 работают, но не обновляются вживую —
// изменения видны после перезагрузки страницы. Сам RealtimeProvider и
// lib/realtime.ts оставлены в репозитории как образец подписки на случай,
// если live-обновления будут делаться заново поверх SSE.

import { TimingProvider } from "@/components/timing/TimingProvider";
import { GlobalTimerWidget } from "@/components/timing/GlobalTimerWidget";
import { IdleDialog } from "@/components/timing/IdleDialog";
import { TimerUndoToast } from "@/components/timing/TimerUndoToast";

export function LegacyRuntime() {
  return (
    <>
      <TimingProvider />
      <GlobalTimerWidget />
      <IdleDialog />
      <TimerUndoToast />
    </>
  );
}

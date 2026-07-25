"use client";

// Фоновая обвязка интерфейса v1: Realtime-подписка на таблицы `public`,
// провайдер тайм-трекинга и его виджеты. Собрана в один модуль, чтобы
// LegacyRuntimeGate мог грузить её отдельным чанком и только там, где она нужна.

import { RealtimeProvider } from "@/components/RealtimeProvider";
import { TimingProvider } from "@/components/timing/TimingProvider";
import { GlobalTimerWidget } from "@/components/timing/GlobalTimerWidget";
import { IdleDialog } from "@/components/timing/IdleDialog";
import { TimerUndoToast } from "@/components/timing/TimerUndoToast";

export function LegacyRuntime() {
  return (
    <>
      <RealtimeProvider />
      <TimingProvider />
      <GlobalTimerWidget />
      <IdleDialog />
      <TimerUndoToast />
    </>
  );
}

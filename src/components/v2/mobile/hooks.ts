"use client";

// Привычки, которых нет у десктопной оболочки: аппаратная «Назад» закрывает
// верхний слой, возврат в приложение обновляет данные, состояние сети видно.
//
// Все клиентские признаки читаются через useSyncExternalStore, а не через
// setState в эффекте: серверный снимок задан явно, поэтому гидрация не
// расходится и правило react-hooks/set-state-in-effect не нарушается.

import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { todayIso } from "@/lib/core/views";

// ---- Аппаратная «Назад» ----
//
// Пока открыт хотя бы один слой (карточка задачи, поиск, диалог), в истории
// висит ровно одна лишняя запись. «Назад» закрывает верхний слой; если под ним
// есть ещё — запись ставится снова. Стек общий на модуль: два слоя, открытых
// одновременно, иначе гоняли бы pushState и back наперегонки.

interface Layer {
  close: () => void;
}

const layerStack: Layer[] = [];
let popstateBound = false;

function pushHistoryEntry(): void {
  window.history.pushState({ sbLayer: true }, "");
}

function ensurePopstateListener(): void {
  if (popstateBound) return;
  popstateBound = true;
  window.addEventListener("popstate", () => {
    const top = layerStack.pop();
    if (!top) return; // обычная навигация, слоёв нет
    // Под закрытым слоем есть ещё один — возвращаем запись для следующего «Назад».
    if (layerStack.length > 0) pushHistoryEntry();
    top.close();
  });
}

/**
 * «Назад» на Android закрывает открытый слой, а не уводит с экрана. Закрытие
 * из интерфейса снимает лишнюю запись обратно — но только если за это время
 * никто не увёл страницу и не открыл другой слой (иначе back() отменил бы
 * чужой переход). В сомнительном случае запись остаётся: одно холостое
 * «Назад» безобиднее сорванной навигации.
 */
export function useBackDismiss(open: boolean, onClose: () => void): void {
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    ensurePopstateListener();
    const layer: Layer = { close: () => closeRef.current() };
    if (layerStack.length === 0) pushHistoryEntry();
    layerStack.push(layer);
    const openedAt = window.location.href;

    return () => {
      const i = layerStack.indexOf(layer);
      if (i === -1) return; // слой уже снят обработчиком popstate
      layerStack.splice(i, 1);
      if (layerStack.length > 0) return;
      setTimeout(() => {
        if (layerStack.length > 0) return;
        if (window.location.href !== openedAt) return;
        const state = window.history.state as { sbLayer?: boolean } | null;
        if (state?.sbLayer) window.history.back();
      }, 0);
    };
  }, [open]);
}

/** Не чаще одного обновления в этот интервал: переключение вкладок таб-бара
 *  не должно превращаться в шквал запросов. */
const RESUME_GAP_MS = 10_000;

/**
 * Установленное приложение неделями живёт в фоне — таймеры там заморожены, и
 * при возврате пользователь видит данные прошлого запуска. Обновляем экран,
 * когда он снова становится видимым или когда вернулась сеть.
 */
export function useAppResume(refresh: () => void | Promise<void>): void {
  const refreshRef = useRef(refresh);
  useEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);

  useEffect(() => {
    let last = Date.now();
    function maybeRefresh() {
      if (document.visibilityState !== "visible") return;
      const now = Date.now();
      if (now - last < RESUME_GAP_MS) return;
      last = now;
      void refreshRef.current();
    }
    document.addEventListener("visibilitychange", maybeRefresh);
    window.addEventListener("online", maybeRefresh);
    // Safari возвращает страницу из bfcache без перезапуска эффектов.
    window.addEventListener("pageshow", maybeRefresh);
    return () => {
      document.removeEventListener("visibilitychange", maybeRefresh);
      window.removeEventListener("online", maybeRefresh);
      window.removeEventListener("pageshow", maybeRefresh);
    };
  }, []);
}

/**
 * Тап по уведомлению в уже открытом приложении. Service worker шлёт адрес
 * сообщением, оболочка превращает его в это событие — экран открывает карточку
 * без перезагрузки страницы. Через URL это не сделать: повторный тап по тому
 * же уведомлению не меняет адрес, и эффект бы не сработал.
 */
export const TASK_DEEPLINK_EVENT = "sb:open-task";

export function useTaskDeepLink(onOpen: (taskId: string) => void): void {
  const openRef = useRef(onOpen);
  useEffect(() => {
    openRef.current = onOpen;
  }, [onOpen]);

  useEffect(() => {
    function onEvent(e: Event) {
      const id = (e as CustomEvent<string>).detail;
      if (typeof id === "string" && id) openRef.current(id);
    }
    window.addEventListener(TASK_DEEPLINK_EVENT, onEvent);
    return () => window.removeEventListener(TASK_DEEPLINK_EVENT, onEvent);
  }, []);
}

function subscribeNetwork(cb: () => void): () => void {
  window.addEventListener("online", cb);
  window.addEventListener("offline", cb);
  return () => {
    window.removeEventListener("online", cb);
    window.removeEventListener("offline", cb);
  };
}

/** Сеть пропала — списки не врут «пусто», а показывают, что данные старые. */
export function useOnline(): boolean {
  return useSyncExternalStore(
    subscribeNetwork,
    () => navigator.onLine,
    () => true,
  );
}

const STANDALONE_QUERY = "(display-mode: standalone)";

function subscribeStandalone(cb: () => void): () => void {
  const mq = window.matchMedia(STANDALONE_QUERY);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}

function standaloneSnapshot(): boolean {
  return (
    window.matchMedia(STANDALONE_QUERY).matches ||
    // iOS до 17 не поддерживает display-mode и выдаёт признак отдельным полем.
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

/** Приложение открыто с домашнего экрана, а не во вкладке браузера. */
export function useStandalone(): boolean {
  return useSyncExternalStore(subscribeStandalone, standaloneSnapshot, () => false);
}

function noopSubscribe(): () => void {
  return () => {};
}

/** Как часто сверяем, не наступил ли следующий день. */
const DAY_TICK_MS = 60_000;

function subscribeDay(cb: () => void): () => void {
  const id = window.setInterval(cb, DAY_TICK_MS);
  return () => window.clearInterval(id);
}

/**
 * Сегодняшний день браузера, `null` до гидрации.
 *
 * Зона процесса на сервере — UTC контейнера, а не зона читателя: посчитанное там
 * «сегодня» ночью отличается на сутки, и календарь, отрисованный на сервере,
 * разошёлся бы с браузерным на целый месяц. Поэтому серверный снимок пустой —
 * ровно тот случай, ради которого у `useSyncExternalStore` есть третий аргумент.
 *
 * Тик раз в минуту переводит день в полночь сам: строка та же — React ничего не
 * перерисует, сменилась — экран переедет на новый день.
 */
export function useToday(): string | null {
  return useSyncExternalStore(subscribeDay, todayIso, () => null);
}

function iosSnapshot(): boolean {
  // iPadOS прикидывается макбуком, выдаёт себя мультитачем.
  const iPadOs = navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
  return /iPhone|iPad|iPod/i.test(navigator.userAgent) || iPadOs;
}

/** На iOS установка только руками через «Поделиться» — программной нет. */
export function useIos(): boolean {
  return useSyncExternalStore(noopSubscribe, iosSnapshot, () => false);
}

const FLAG_EVENT = "sb:localflag";

function readFlag(key: string, ttlMs: number): boolean {
  try {
    const at = window.localStorage.getItem(key);
    return !!at && Date.now() - Number(at) < ttlMs;
  } catch {
    // приватный режим — считаем, что подсказку не скрывали
    return false;
  }
}

/**
 * «Скрыто до поры» — отметка в localStorage с временем жизни. Возвращает
 * признак и функцию скрытия; подписка на собственное событие нужна, чтобы
 * все использующие компоненты перерисовались сразу.
 */
export function useDismissFlag(key: string, ttlMs: number): [boolean, () => void] {
  const dismissed = useSyncExternalStore(
    (cb) => {
      window.addEventListener(FLAG_EVENT, cb);
      return () => window.removeEventListener(FLAG_EVENT, cb);
    },
    () => readFlag(key, ttlMs),
    () => true, // на сервере подсказок не рисуем — иначе они мигают при гидрации
  );

  const dismiss = useCallback(() => {
    try {
      window.localStorage.setItem(key, String(Date.now()));
    } catch {
      // приватный режим — подсказка вернётся в следующий раз
    }
    window.dispatchEvent(new Event(FLAG_EVENT));
  }, [key]);

  return [dismissed, dismiss];
}

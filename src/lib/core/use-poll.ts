"use client";

import { useEffect, useRef } from "react";

/**
 * Периодическая фоновая сверка, которая молчит в скрытой вкладке.
 *
 * Зачем: оболочка опрашивала счётчик уведомлений раз в 30 секунд, а виджет
 * таймера — раз в минуту, независимо от того, смотрит ли кто-то на страницу.
 * Каждый опрос — отдельная серверная функция, которая заново разрешает
 * пользователя и членство: открытая фоном вкладка сутками занимала этим
 * соединения к базе, нужные настоящим действиям.
 *
 * При возвращении во вкладку сверка идёт сразу, а не по следующему тику, —
 * иначе пауза выглядела бы как подвисшие данные.
 */
export function usePollWhenVisible(fn: () => void, intervalMs: number): void {
  const saved = useRef(fn);

  // Через ref, а не в зависимостях интервала: иначе новая ссылка на колбэк на
  // каждый рендер пересоздавала бы таймер и сверка не наступала бы никогда.
  useEffect(() => {
    saved.current = fn;
  }, [fn]);

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;

    const stop = () => {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    };
    const start = () => {
      if (timer === null) timer = setInterval(() => saved.current(), intervalMs);
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        saved.current();
        start();
      } else {
        stop();
      }
    };

    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [intervalMs]);
}

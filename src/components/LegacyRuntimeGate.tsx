"use client";

// Обвязка v1 живёт в корневом layout, то есть монтировалась и на экранах v2.
// Цена для v2 была вполне ощутимой: браузерный клиент Supabase (~220 КБ) в
// бандле каждой страницы, WebSocket Realtime на таблицы `public`, несколько
// setInterval и слушатели активности на document — ради функций, которых в v2
// нет. Экран целиком принадлежит одной версии, поэтому обвязку v1 грузим
// отдельным чанком и только вне /v2.

import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";

const LegacyRuntime = dynamic(() => import("./LegacyRuntime").then((m) => m.LegacyRuntime), {
  ssr: false,
});

export function LegacyRuntimeGate() {
  const pathname = usePathname();
  if (pathname.startsWith("/v2")) return null;
  return <LegacyRuntime />;
}

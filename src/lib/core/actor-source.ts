// Чем сделано действие: руками в интерфейсе или через внешний канал.
//
// Здесь только словарь и подпись — ничего серверного. Это намеренно: метку
// рисуют лента задачи и журнал действий, то есть клиентские компоненты, а само
// хранилище источника живёт в `actor-source-store.ts` и тянет `node:async_hooks`,
// которому в браузерном бандле делать нечего.

/** Каналы, которые умеют помечать свои действия. Пополняется вместе с интеграциями. */
export type ActorSource = "claude";

/** Подпись источника для интерфейса. Один текст на ленту, журнал и комментарии. */
export const ACTOR_SOURCE_LABELS: Record<ActorSource, string> = {
  claude: "через Claude",
};

export function actorSourceLabel(source: string | null | undefined): string | null {
  if (!source) return null;
  return ACTOR_SOURCE_LABELS[source as ActorSource] ?? null;
}

// Чем сделано действие: руками в интерфейсе или через внешний канал.
//
// Признак нужен доменному слою (событие пишет `emitEvent`, комментарий —
// `addTaskComment`), но НЕ является частью прав: policy решает по AuthContext,
// а источник только описывает, как запрос попал в приложение.
//
// Отсюда способ передачи — AsyncLocalStorage, а не поле в AuthContext и не
// лишний аргумент у emitEvent. Событий в ядре десятки, и они пишутся из
// середины транзакций; протаскивать признак через каждую сигнатуру значит
// однажды забыть его в новом вызове — и получить действие Клода, неотличимое
// от ручного. Хранилище же покрывает всё, что вызвано изнутри `runAs`, включая
// код, написанный после.
//
// NB: работает только в Node-рантайме. Роуты, которым нужен источник, node и
// используют (им нужен postgres.js); в Edge-рантайме `currentActorSource()`
// вернёт null, то есть «интерфейс» — безопасное умолчание.

import { AsyncLocalStorage } from "node:async_hooks";

/** Каналы, которые умеют помечать свои действия. Пополняется вместе с интеграциями. */
export type ActorSource = "claude";

const storage = new AsyncLocalStorage<ActorSource>();

/** Выполнить работу от указанного источника: всё внутри пометит себя им. */
export function runAs<T>(source: ActorSource, fn: () => Promise<T>): Promise<T> {
  return storage.run(source, fn);
}

/** Источник текущего действия или null — «человек в интерфейсе». */
export function currentActorSource(): ActorSource | null {
  return storage.getStore() ?? null;
}

/** Подпись источника для интерфейса. Один текст на ленту, инбокс и комментарии. */
export const ACTOR_SOURCE_LABELS: Record<ActorSource, string> = {
  claude: "через Claude",
};

export function actorSourceLabel(source: string | null | undefined): string | null {
  if (!source) return null;
  return ACTOR_SOURCE_LABELS[source as ActorSource] ?? null;
}

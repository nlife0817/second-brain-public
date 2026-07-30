"use client";

// Открытие ссылок из текста — описания задачи, комментария, вложения.
//
// Ссылка обязана уходить в новую вкладку: описание и комментарий живут в слое
// поверх списка задач, и переход в той же вкладке уносил бы пользователя из
// приложения вместе с несохранёнными правками. Полагаться на атрибут `target`
// разметки нельзя — в описаниях, сохранённых до этой правки, лежит `_self`
// (так их записывал санитайзер), и такая ссылка открылась бы поверх приложения.
//
// Правило клика зависит от того, правится текст или читается:
//   * поле правки (описание с правами на изменение, черновик комментария) —
//     Ctrl/Cmd+клик. Обычный клик обязан ставить курсор, иначе текст ссылки
//     нечем править мышью;
//   * готовый текст (комментарий в ленте, описание без прав) — обычный клик.
// Касание — исключение: модификатора на телефоне нет, и тап по ссылке в
// описании открывает её даже в режиме правки.
//
// Здесь только работа с DOM, без Tiptap: карточка задачи подключает редактор
// через dynamic() и не должна из-за этих же правил тянуть его в свой бандл.
// Расширение редактора, которое зовёт эти функции, — в OpenLink.ts.

import type { MouseEvent as ReactMouseEvent } from "react";

/**
 * Уводит по адресу в новой вкладке.
 *
 * `noopener` здесь не для красоты: `rel` разметки на `window.open` не
 * распространяется, и без него открытая страница получает ссылку на наше окно
 * через `window.opener`. Почтовые и телефонные адреса открывает внешнее
 * приложение — новая вкладка для них осталась бы пустой.
 */
export function openLinkInNewTab(href: string): void {
  if (/^(?:mailto|tel):/i.test(href)) {
    window.location.href = href;
    return;
  }
  window.open(href, "_blank", "noopener,noreferrer");
}

/** Ближайшая ссылка над точкой клика, если по ней вообще есть куда идти. */
export function anchorFromEvent(event: Event): HTMLAnchorElement | null {
  const target = event.target;
  if (!(target instanceof Element)) return null;
  const anchor = target.closest("a[href]");
  if (!(anchor instanceof HTMLAnchorElement)) return null;
  // Кнопка «Скачать» у вложения — тоже ссылка, но её дело отдать файл, а не
  // открыть вкладку.
  if (anchor.hasAttribute("download")) return null;
  return anchor;
}

/**
 * Палец вместо мыши. `pointerType` есть у современного click (он PointerEvent),
 * а запрос к медиа остаётся на случай, когда браузер прислал обычный MouseEvent.
 */
function isTouchClick(event: MouseEvent): boolean {
  if (event instanceof PointerEvent && event.pointerType) return event.pointerType === "touch";
  return window.matchMedia("(pointer: coarse)").matches;
}

/**
 * Открывать ли ссылку вместо обычной реакции на клик.
 *
 * `editable` — правится ли текст прямо сейчас. Средняя кнопка, Shift и Alt сюда
 * не попадают: у браузера на них свои осмысленные действия.
 */
export function shouldOpenLink(event: MouseEvent, editable: boolean): boolean {
  if (event.button !== 0 || event.shiftKey || event.altKey) return false;
  if (!editable) return true;
  return event.metaKey || event.ctrlKey || isTouchClick(event);
}

/**
 * Клик по готовому тексту, который выводится разметкой, а не редактором:
 * комментарии в ленте задачи и в панели обсуждения. Правки там нет — открывает
 * любой клик.
 */
export function handleRichTextClick(event: ReactMouseEvent<HTMLElement>): void {
  const anchor = anchorFromEvent(event.nativeEvent);
  if (!anchor || !shouldOpenLink(event.nativeEvent, false)) return;
  event.preventDefault();
  // `anchor.href` вместо атрибута: вложение приезжает относительной ссылкой на
  // роут отдачи файла.
  openLinkInNewTab(anchor.href);
}

// Загрузка вложений v1 — отключена после переезда на собственный VPS.
//
// Файлы жили в приватном бакете Supabase Storage и раздавались по подписанным
// ссылкам. Вместе с уходом от Supabase v1 заморожена, поэтому хранилище не
// переносилось: новые файлы загрузить нельзя, а ссылки в старых задачах ведут
// туда, куда выгружен бакет (см. docs/VPS-MIGRATION.md, §7).
//
// Модуль сохранён с прежними сигнатурами: его зовёт редактор в
// components/task/TaskDetailSheet.tsx (вставка, drag-n-drop, кнопка «Прикрепить»),
// и все три вызова ловят исключение. Когда понадобится загрузка на v2 —
// заменить тело на POST в собственный роут, интерфейс останется тем же.

export type UploadResult = {
  path: string;
  url: string;
  name: string;
  size: number;
  mimeType: string;
};

const DISABLED_MESSAGE =
  "Загрузка вложений отключена: интерфейс v1 заморожен после переезда на собственный сервер.";

export async function uploadAttachment(file: File): Promise<UploadResult> {
  throw new Error(`${DISABLED_MESSAGE} Файл «${file.name}» не сохранён.`);
}

export async function uploadDataUrl(
  dataUrl: string,
  suggestedName = "image.png",
): Promise<UploadResult> {
  const mimeType = dataUrl.slice(5, dataUrl.indexOf(";")) || "unknown";
  throw new Error(`${DISABLED_MESSAGE} Вставка «${suggestedName}» (${mimeType}) не сохранена.`);
}

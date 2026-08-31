// Владелец документа со стороны браузера: описание задачи или документ базы
// знаний. Зеркало серверного `DocOwner` — редактор у них общий, поэтому и
// оболочки (`RichText`, `DocEditor`, панель обсуждений) принимают владельца, а
// не `taskId`.
//
// Отличается у них ровно один путь API: дальше и вложения, и треды, и
// упоминания живут по общим адресам.

import type { DocOwner } from "@/lib/core/types";

export type { DocOwner };

/** Владелец-задача. Черновик задачи владельца ещё не имеет — отсюда `null`. */
export function taskOwner(taskId: string | null | undefined): DocOwner | null {
  return taskId ? { kind: "task", taskId } : null;
}

export function documentOwner(documentId: string | null | undefined): DocOwner | null {
  return documentId ? { kind: "document", documentId } : null;
}

/** Базовый путь API владельца — от него строятся `/attachments` и `/doc-comments`. */
export function ownerPath(orgId: string, owner: DocOwner): string {
  return owner.kind === "task"
    ? `/orgs/${orgId}/tasks/${owner.taskId}`
    : `/orgs/${orgId}/kb/${owner.documentId}`;
}

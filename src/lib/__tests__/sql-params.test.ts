// Граница драйвера: undefined в параметрах запроса.
//
// postgres.js бросает на нём UNDEFINED_VALUE без текста запроса и номера
// параметра — именно так в проде выглядели 500-е на приёме приглашения, и по
// логу было не понять, какое поле не заполнено. Проверка ниже срабатывает до
// обращения к БД, поэтому тесту не нужен ни коннект, ни переменные окружения.

import { describe, expect, it } from "vitest";
import { prepare } from "../sql";

describe("prepare(): undefined в параметрах", () => {
  it("называет номер параметра и запрос", async () => {
    await expect(
      prepare(`SELECT * FROM core.users WHERE auth_user_id = ?`).get(undefined),
    ).rejects.toThrow(/параметр \$1 равен undefined.*SELECT \* FROM core\.users/);
  });

  it("считает номер по позиции в запросе", async () => {
    await expect(
      prepare(`INSERT INTO core.project_members (project_id, user_id, role) VALUES (?, ?, ?)`).run(
        "9a0b6a4c-0000-4000-8000-0000000000aa",
        undefined,
        "editor",
      ),
    ).rejects.toThrow(/параметр \$2 равен undefined/);
  });

  it("учитывает расплющивание массивов-аргументов", async () => {
    // Массив разворачивается в позиционные параметры, поэтому undefined внутри
    // него — это $3, а не $2.
    await expect(
      prepare(`SELECT * FROM core.tasks WHERE org_id = ? AND id IN (?, ?)`).all("org", [
        "task",
        undefined,
      ]),
    ).rejects.toThrow(/параметр \$3 равен undefined/);
  });
});

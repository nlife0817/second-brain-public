// Серверная оболочка v2: состояние сайдбара считается здесь и уезжает в первый
// HTML. Раньше на его месте был клиентский компонент, который после гидрации
// начинал с /me, ждал ответа, дёргал шесть справочников и только потом отпускал
// страницу за её данными — три последовательные волны запросов до первого байта
// содержимого.

import { loadV2Bootstrap } from "@/lib/core/bootstrap";
import { V2Shell } from "./V2Shell";

export default async function V2Layout({ children }: { children: React.ReactNode }) {
  const boot = await loadV2Bootstrap();
  return (
    <V2Shell initial={boot.state === "ok" ? boot.data : null} state={boot.state}>
      {children}
    </V2Shell>
  );
}

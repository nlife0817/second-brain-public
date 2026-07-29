// Серверная оболочка v2: состояние сайдбара считается здесь и уезжает в первый
// HTML. Раньше на его месте был клиентский компонент, который после гидрации
// начинал с /me, ждал ответа, дёргал шесть справочников и только потом отпускал
// страницу за её данными — три последовательные волны запросов до первого байта
// содержимого.
//
// Стор наполняется тут же, до рендера детей: экраны читают его прямо в рендере,
// и на сервере он обязан быть таким же, как в браузере.

import { cookies } from "next/headers";
import { loadV2Bootstrap } from "@/lib/core/bootstrap";
import { SIDEBAR_COLLAPSED_COOKIE } from "@/lib/core/keys";
import { V2StoreProvider } from "@/lib/core/ui-store";
import { V2Shell } from "./V2Shell";

export default async function V2Layout({ children }: { children: React.ReactNode }) {
  const [boot, jar] = await Promise.all([loadV2Bootstrap(), cookies()]);
  const initial = boot.state === "ok" ? boot.data : null;
  // Ширина сайдбара обязана быть верной в первом кадре — иначе панель
  // разворачивается и схлопывается на глазах у пользователя.
  const collapsed = jar.get(SIDEBAR_COLLAPSED_COOKIE)?.value === "1";
  return (
    <V2StoreProvider initial={initial}>
      <V2Shell
        state={boot.state}
        onboardingUser={boot.state === "onboarding" ? boot.me : null}
        initialCollapsed={collapsed}
      >
        {children}
      </V2Shell>
    </V2StoreProvider>
  );
}

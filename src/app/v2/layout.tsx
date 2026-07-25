// Серверная оболочка v2: состояние сайдбара считается здесь и уезжает в первый
// HTML. Раньше на его месте был клиентский компонент, который после гидрации
// начинал с /me, ждал ответа, дёргал шесть справочников и только потом отпускал
// страницу за её данными — три последовательные волны запросов до первого байта
// содержимого.
//
// Стор наполняется тут же, до рендера детей: экраны читают его прямо в рендере,
// и на сервере он обязан быть таким же, как в браузере.

import { loadV2Bootstrap } from "@/lib/core/bootstrap";
import { V2StoreProvider } from "@/lib/core/ui-store";
import { V2Shell } from "./V2Shell";

export default async function V2Layout({ children }: { children: React.ReactNode }) {
  const boot = await loadV2Bootstrap();
  const initial = boot.state === "ok" ? boot.data : null;
  return (
    <V2StoreProvider initial={initial}>
      <V2Shell state={boot.state} onboardingUser={boot.state === "onboarding" ? boot.me : null}>
        {children}
      </V2Shell>
    </V2StoreProvider>
  );
}

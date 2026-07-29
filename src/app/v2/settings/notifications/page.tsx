"use client";

// Раздел уведомлений: доставка на это устройство, список подписанных
// устройств и правила «что присылать».
//
// Отдельная страница, а не блок в настройках организации: настройки
// организации доступны администраторам, а уведомления настраивает себе
// каждый — включая гостя, которому раздел «Настройки» в сайдбаре не показан.

import Link from "next/link";
import { ArrowLeft, Bell } from "lucide-react";
import { PushToggle } from "@/components/v2/PushToggle";
import { NotificationKinds, PushDevices, PushTestButton } from "@/components/v2/NotificationSettings";

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <h2 className="text-sm font-semibold">{title}</h2>
      {description && <p className="mt-1 text-xs text-muted-foreground">{description}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

export default function NotificationSettingsPage() {
  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b border-border px-6 py-3.5">
        <Link
          href="/v2/inbox"
          className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          title="К уведомлениям"
        >
          <ArrowLeft className="size-4" />
        </Link>
        <h1 className="text-base font-semibold">Уведомления</h1>
      </header>

      <div className="flex-1 overflow-y-auto px-6 py-4">
        <div className="mx-auto flex max-w-2xl flex-col gap-3">
          <Section
            title="Доставка в этот браузер"
            description="Уведомления приходят системным сообщением, даже когда вкладка свёрнута. Разрешение спрашивает сам браузер — отозвать его можно там же, в настройках сайта."
          >
            <PushToggle />
            <div className="mt-3 flex items-center gap-2 border-t border-border pt-3">
              <Bell className="size-4 shrink-0 text-muted-foreground" />
              <p className="flex-1 text-sm text-muted-foreground">
                Проверить, что уведомления доходят
              </p>
              <PushTestButton />
            </div>
          </Section>

          <Section
            title="Устройства"
            description="Каждый браузер и каждый телефон подписываются отдельно. Лишнюю подписку можно снять здесь — например, с чужого компьютера."
          >
            <PushDevices />
          </Section>

          <Section
            title="Какие события присылать"
            description="«В приложении» — строка в этом разделе и счётчик в сайдбаре. «Push» — системное уведомление на подписанные устройства. Настройка общая для всех ваших организаций."
          >
            <NotificationKinds />
          </Section>
        </div>
      </div>
    </div>
  );
}

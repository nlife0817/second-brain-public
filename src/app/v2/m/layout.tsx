// Серверный layout мобильной версии v2: перекрывает PWA-метаданные корня
// (манифест v1 → манифест v2 со start_url /v2/m/my) и монтирует клиентскую
// оболочку с нижним таб-баром. Экраны /v2/m/* живут внутри /v2/layout.tsx,
// который для мобильных путей отдаёт детей без десктопного сайдбара.

import type { Metadata, Viewport } from "next";
import { MobileShell } from "@/components/v2/mobile/MobileShell";
import { INSTALL_CAPTURE_SNIPPET } from "@/components/v2/mobile/install-capture";

export const metadata: Metadata = {
  title: "Задачи",
  manifest: "/manifest-v2.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Задачи",
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
  ],
  width: "device-width",
  initialScale: 1,
  // Без cover контент не заходит под чёлку и safe-area-inset-* всегда нули.
  viewportFit: "cover",
};

export default function V2MobileLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {/* Выполняется при разборе разметки — раньше гидрации: иначе событие
          установки успевает пройти мимо и баннер не появляется. */}
      <script dangerouslySetInnerHTML={{ __html: INSTALL_CAPTURE_SNIPPET }} />
      <MobileShell>{children}</MobileShell>
    </>
  );
}

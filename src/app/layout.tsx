import type { Metadata, Viewport } from "next";
import { Golos_Text, Inter, JetBrains_Mono } from "next/font/google";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { ServiceWorkerRegister } from "@/components/ServiceWorkerRegister";
import "./globals.css";

const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin", "cyrillic"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin", "cyrillic"],
});

// Заголовки: Golos Text рисован под кириллицу и даёт экранам собственное
// лицо; текст остаётся на Inter (`--font-sans`).
const golos = Golos_Text({
  variable: "--font-golos",
  subsets: ["latin", "cyrillic"],
});

export const metadata: Metadata = {
  title: "Задачи — командный трекер",
  description: "Задачи, проекты и уведомления команды",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Задачи",
  },
  icons: {
    icon: [
      { url: "/icons/icon.svg", type: "image/svg+xml" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
  },
};

export const viewport: Viewport = {
  themeColor: "#ffffff",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="ru"
      className={`${inter.variable} ${jetbrainsMono.variable} ${golos.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col overflow-hidden font-sans">
        <ErrorBoundary>
          <TooltipProvider>
            {children}
          </TooltipProvider>
          <ServiceWorkerRegister />
        </ErrorBoundary>
      </body>
    </html>
  );
}

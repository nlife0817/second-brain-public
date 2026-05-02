import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { ServiceWorkerRegister } from "@/components/ServiceWorkerRegister";
import { RealtimeProvider } from "@/components/RealtimeProvider";
import { TimingProvider } from "@/components/timing/TimingProvider";
import { GlobalTimerWidget } from "@/components/timing/GlobalTimerWidget";
import "./globals.css";

const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin", "cyrillic"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin", "cyrillic"],
});

export const metadata: Metadata = {
  title: "Second Brain",
  description: "Your AI-powered second brain for task management",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Second Brain",
  },
  icons: {
    icon: "/icons/icon-192.png",
    apple: "/icons/icon-192.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#7c3aed",
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
      className={`${inter.variable} ${jetbrainsMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col overflow-hidden font-sans">
        <ErrorBoundary>
          <TooltipProvider>
            {children}
          </TooltipProvider>
          <ServiceWorkerRegister />
          <RealtimeProvider />
          <TimingProvider />
          <GlobalTimerWidget />
        </ErrorBoundary>
      </body>
    </html>
  );
}

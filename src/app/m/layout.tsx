import type { Metadata, Viewport } from "next";
import { MobileBottomNav } from "@/components/mobile/MobileBottomNav";

export const metadata: Metadata = {
  title: "Second Brain — Mobile",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function MobileLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen flex-col bg-background">
      <main className="flex-1 overflow-y-auto pb-16">{children}</main>
      <MobileBottomNav />
    </div>
  );
}

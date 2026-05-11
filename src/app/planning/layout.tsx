"use client";

import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { ChevronLeft, ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";
import { Toaster } from "sonner";

const NAV: Array<{ href: string; label: string }> = [
  { href: "/planning/columns",       label: "Колонки" },
  { href: "/planning/this-week",     label: "Эта неделя" },
  { href: "/planning/this-month",    label: "Этот месяц" },
  { href: "/planning/this-quarter",  label: "Этот квартал" },
  { href: "/planning/roadmap",       label: "Roadmap" },
  { href: "/planning/digest",        label: "Сводка" },
  { href: "/planning/deals",         label: "Сделки" },
  { href: "/planning/blocked-deals", label: "Заблокированные" },
  { href: "/planning/changelog",     label: "Журнал" },
  { href: "/planning/settings",      label: "Настройки" },
];

export default function PlanningLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();

  return (
    <div className="flex h-screen flex-col bg-white text-slate-900">
      <header className="flex h-12 shrink-0 items-center gap-1 border-b border-slate-200 px-3 overflow-x-auto">
        <button
          onClick={() => router.back()}
          className="mr-1 inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-slate-500 hover:bg-slate-100 hover:text-slate-700"
          title="Назад в истории навигации"
        >
          <ChevronLeft className="size-3.5" />
          Назад
        </button>
        <Link
          href="/"
          className="mr-3 inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-slate-500 hover:bg-slate-100 hover:text-slate-700"
          title="В задачи (главный интерфейс)"
        >
          <ArrowLeft className="size-3.5" />
          В задачи
        </Link>
        <nav className="flex items-center gap-0.5 text-sm">
          {NAV.map((it) => {
            const active = pathname === it.href || pathname.startsWith(`${it.href}/`);
            return (
              <Link
                key={it.href}
                href={it.href}
                aria-current={active ? "page" : undefined}
                className={`rounded-md px-3 py-1.5 transition-colors ${
                  active
                    ? "bg-slate-900 text-white"
                    : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                }`}
              >
                {it.label}
              </Link>
            );
          })}
        </nav>
      </header>
      <main className="flex-1 overflow-auto">
        {children}
      </main>
      <Toaster position="top-right" richColors closeButton />
    </div>
  );
}

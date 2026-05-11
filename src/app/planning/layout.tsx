import Link from "next/link";
import type { ReactNode } from "react";
import { Toaster } from "sonner";

const NAV: Array<{ href: string; label: string }> = [
  { href: "/planning/columns", label: "Колонки" },
  { href: "/planning/this-week", label: "Эта неделя" },
  { href: "/planning/this-month", label: "Этот месяц" },
  { href: "/planning/this-quarter", label: "Этот квартал" },
  { href: "/planning/roadmap", label: "Roadmap" },
  { href: "/planning/digest", label: "Сводка" },
  { href: "/planning/deals", label: "Сделки" },
  { href: "/planning/blocked-deals", label: "Заблокированные" },
  { href: "/planning/changelog", label: "Журнал" },
  { href: "/planning/settings", label: "Настройки" },
];

export default function PlanningLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-screen flex-col bg-white text-slate-900">
      <header className="flex h-12 shrink-0 items-center gap-1 border-b border-slate-200 px-4 overflow-x-auto">
        <Link href="/" className="mr-4 text-sm font-semibold text-slate-700 hover:text-slate-900">
          ← В задачи
        </Link>
        <nav className="flex items-center gap-0.5 text-sm">
          {NAV.map((it) => (
            <Link
              key={it.href}
              href={it.href}
              className="rounded-md px-3 py-1.5 text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900"
            >
              {it.label}
            </Link>
          ))}
        </nav>
      </header>
      <main className="flex-1 overflow-auto">
        {children}
      </main>
      <Toaster position="top-right" richColors closeButton />
    </div>
  );
}

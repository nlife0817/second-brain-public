"use client";

// Общая шапка раздела CRM. Экраны разные (у доски и у справочника клиентов свои
// серверные выборки), а раздел один — вкладки живут здесь, чтобы обе страницы
// показывали одинаковый ряд и подсвечивали текущую.

import Link from "next/link";

const TABS = [
  { id: "board", href: "/v2/crm", label: "Сделки" },
  { id: "funnel", href: "/v2/crm/funnel", label: "Воронка" },
  { id: "clients", href: "/v2/clients", label: "Клиенты" },
] as const;

export function CrmTabs({ active }: { active: (typeof TABS)[number]["id"] }) {
  return (
    <div className="flex items-center gap-1 border-b px-4 py-2">
      <h1 className="mr-3 text-base font-semibold">CRM</h1>
      {TABS.map((t) => (
        <Link
          key={t.id}
          href={t.href}
          className={`rounded-lg px-2.5 py-1 text-sm transition ${
            t.id === active
              ? "bg-foreground text-background font-medium"
              : "text-muted-foreground hover:bg-muted hover:text-foreground"
          }`}
        >
          {t.label}
        </Link>
      ))}
    </div>
  );
}

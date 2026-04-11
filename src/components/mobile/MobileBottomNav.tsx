"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Inbox, CheckSquare, StickyNote } from "lucide-react";
import { cn } from "@/lib/utils";

const tabs = [
  { href: "/m/inbox", icon: Inbox, label: "Inbox" },
  { href: "/m/tasks", icon: CheckSquare, label: "Задачи" },
  { href: "/m/notes", icon: StickyNote, label: "Заметки" },
];

export function MobileBottomNav() {
  const pathname = usePathname();

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 border-t border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <div className="flex h-16 items-stretch">
        {tabs.map(({ href, icon: Icon, label }) => {
          const active = pathname === href || pathname.startsWith(href + "/");
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex flex-1 flex-col items-center justify-center gap-1 text-xs transition-colors",
                active
                  ? "text-violet-600"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Icon
                className={cn("h-5 w-5", active && "stroke-[2.5px]")}
              />
              <span className={cn("font-medium", active && "text-violet-600")}>
                {label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

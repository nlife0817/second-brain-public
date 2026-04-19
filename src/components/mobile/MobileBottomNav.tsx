"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Inbox, CheckSquare, StickyNote, Settings } from "lucide-react";
import { cn } from "@/lib/utils";

const tabs = [
  { href: "/m/inbox", icon: Inbox, label: "Inbox" },
  { href: "/m/tasks", icon: CheckSquare, label: "Задачи" },
  { href: "/m/notes", icon: StickyNote, label: "Заметки" },
  { href: "/m/settings", icon: Settings, label: "Настройки" },
];

export function MobileBottomNav() {
  const pathname = usePathname();

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 border-t border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      {/* Safe area padding for devices with home indicator */}
      <div className="flex h-16 items-stretch pb-safe">
        {tabs.map(({ href, icon: Icon, label }) => {
          const active = pathname === href || pathname.startsWith(href + "/");
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "relative flex flex-1 flex-col items-center justify-center gap-1 pt-1 text-xs transition-colors",
                active
                  ? "text-violet-600"
                  : "text-muted-foreground active:text-foreground"
              )}
            >
              {/* Active pill indicator at top of tab */}
              <span
                className={cn(
                  "absolute top-0 left-1/2 -translate-x-1/2 rounded-full transition-all duration-200",
                  active
                    ? "h-0.5 w-8 bg-violet-600"
                    : "h-0.5 w-0 bg-transparent"
                )}
                aria-hidden="true"
              />

              <div
                className={cn(
                  "flex h-8 w-14 items-center justify-center rounded-2xl transition-colors duration-150",
                  active ? "bg-violet-100 dark:bg-violet-950" : ""
                )}
              >
                <Icon
                  className={cn(
                    "h-5 w-5 transition-all duration-150",
                    active ? "stroke-[2.5px] text-violet-600" : "stroke-2"
                  )}
                />
              </div>

              <span
                className={cn(
                  "text-[10px] font-medium leading-none transition-colors duration-150",
                  active ? "text-violet-600" : "text-muted-foreground"
                )}
              >
                {label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

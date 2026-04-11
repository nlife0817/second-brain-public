"use client";

import { useEffect } from "react";
import { useBrainStore } from "@/lib/store";
import { MobileInboxForm } from "@/components/mobile/MobileInboxForm";
import { Inbox } from "lucide-react";

export default function MobileInboxPage() {
  const fetchInit = useBrainStore((s) => s.fetchInit);

  useEffect(() => {
    fetchInit();
  }, [fetchInit]);

  return (
    <div className="min-h-full bg-background">
      {/* Header */}
      <div className="sticky top-0 z-10 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="flex items-center gap-3 px-4 py-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-violet-100 dark:bg-violet-950">
            <Inbox className="h-4 w-4 text-violet-600" />
          </div>
          <div>
            <h1 className="text-base font-bold leading-tight text-foreground">Быстрый ввод</h1>
            <p className="text-xs text-muted-foreground">Добавьте задачу, заметку или встречу</p>
          </div>
        </div>
      </div>

      {/* Form */}
      <div className="px-4 py-5">
        <MobileInboxForm />
      </div>
    </div>
  );
}

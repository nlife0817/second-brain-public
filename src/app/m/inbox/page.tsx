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
        <div className="flex items-center gap-3 px-4 py-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-violet-100">
            <Inbox className="h-4 w-4 text-violet-600" />
          </div>
          <h1 className="text-lg font-semibold">Быстрый ввод</h1>
        </div>
      </div>

      {/* Form */}
      <div className="px-4 py-5">
        <MobileInboxForm />
      </div>
    </div>
  );
}

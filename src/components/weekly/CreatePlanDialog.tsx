"use client";

import { useState, useEffect, useMemo } from "react";
import { useBrainStore } from "@/lib/store";
import type { WeeklyPlanEntryWithItem, ItemCategory } from "@/types";
import { CATEGORY_CONFIG, PRIORITY_CONFIG } from "@/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function getMonday(d: Date): Date {
  const date = new Date(d);
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + diff);
  return date;
}

function formatDate(d: Date): string {
  return d.toISOString().split("T")[0];
}

export function CreatePlanDialog({ open, onOpenChange }: Props) {
  const createWeeklyPlan = useBrainStore((s) => s.createWeeklyPlan);
  const weeklyPlans = useBrainStore((s) => s.weeklyPlans);

  const monday = getMonday(new Date());
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);

  const [weekStart, setWeekStart] = useState(formatDate(monday));
  const [weekEnd, setWeekEnd] = useState(formatDate(sunday));
  const [title, setTitle] = useState("");
  const [selectedTransferIds, setSelectedTransferIds] = useState<Set<string>>(new Set());
  const [transferableEntries, setTransferableEntries] = useState<WeeklyPlanEntryWithItem[]>([]);
  const [loading, setLoading] = useState(false);

  // Find last plan and check for transferable entries
  const lastPlanId = weeklyPlans.length > 0 ? weeklyPlans[0].id : null;

  useEffect(() => {
    if (!open || !lastPlanId) {
      setTransferableEntries([]);
      return;
    }

    let ignore = false;
    fetch(`/api/weekly-plans/${lastPlanId}`)
      .then((r) => r.json())
      .then((full) => {
        if (ignore) return;
        const transferable = (full.entries || []).filter(
          (e: WeeklyPlanEntryWithItem) => e.result_status === "transferred"
        );
        setTransferableEntries(transferable);
        setSelectedTransferIds(new Set(transferable.map((e: WeeklyPlanEntryWithItem) => e.item_id)));
      })
      .catch(() => { if (!ignore) setTransferableEntries([]); });

    return () => { ignore = true; };
  }, [open, lastPlanId]);

  const transferByCategory = useMemo(() => {
    const grouped: Partial<Record<ItemCategory, WeeklyPlanEntryWithItem[]>> = {};
    for (const entry of transferableEntries) {
      const cat = entry.item.category;
      if (!grouped[cat]) grouped[cat] = [];
      grouped[cat]!.push(entry);
    }
    return grouped;
  }, [transferableEntries]);

  const toggleTransferId = (itemId: string) => {
    setSelectedTransferIds((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  };

  const handleCreate = async () => {
    setLoading(true);
    try {
      await createWeeklyPlan(
        weekStart,
        weekEnd,
        title || undefined,
        lastPlanId ?? undefined,
        Array.from(selectedTransferIds)
      );
      onOpenChange(false);
    } finally {
      setLoading(false);
    }
  };

  // Update end date when start changes
  const handleStartChange = (value: string) => {
    setWeekStart(value);
    const start = new Date(value + "T00:00:00");
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    setWeekEnd(formatDate(end));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px] bg-white">
        <DialogHeader>
          <DialogTitle>Новый недельный план</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-slate-500 mb-1 block">Начало (пн)</label>
              <Input
                type="date"
                value={weekStart}
                onChange={(e) => handleStartChange((e.target as HTMLInputElement).value)}
                className="h-8 text-sm"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-500 mb-1 block">Конец (вс)</label>
              <Input
                type="date"
                value={weekEnd}
                onChange={(e) => setWeekEnd((e.target as HTMLInputElement).value)}
                className="h-8 text-sm"
              />
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-slate-500 mb-1 block">Название (опционально)</label>
            <Input
              value={title}
              onChange={(e) => setTitle((e.target as HTMLInputElement).value)}
              placeholder="Например: Спринт 12"
              className="h-8 text-sm"
            />
          </div>

          {transferableEntries.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-medium text-slate-500">
                  Перенести из прошлой недели ({selectedTransferIds.size}/{transferableEntries.length})
                </label>
                <div className="flex gap-1">
                  <button
                    className="text-[10px] text-blue-600 hover:underline"
                    onClick={() => setSelectedTransferIds(new Set(transferableEntries.map((e) => e.item_id)))}
                  >
                    Все
                  </button>
                  <span className="text-slate-300">|</span>
                  <button
                    className="text-[10px] text-blue-600 hover:underline"
                    onClick={() => setSelectedTransferIds(new Set())}
                  >
                    Ничего
                  </button>
                </div>
              </div>
              <ScrollArea className="max-h-[200px] border border-slate-200 rounded-md">
                <div className="p-2 space-y-2">
                  {Object.entries(transferByCategory).map(([cat, entries]) => (
                    <div key={cat}>
                      <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide mb-1">
                        {CATEGORY_CONFIG[cat as ItemCategory].label}
                      </p>
                      {entries!.map((entry) => (
                        <label key={entry.id} className="flex items-center gap-2 py-1 px-1 hover:bg-slate-50 rounded cursor-pointer">
                          <Checkbox
                            checked={selectedTransferIds.has(entry.item_id)}
                            onCheckedChange={() => toggleTransferId(entry.item_id)}
                          />
                          {entry.item.priority !== "none" && (
                            <span className={cn("text-xs", PRIORITY_CONFIG[entry.item.priority].color)}>
                              {PRIORITY_CONFIG[entry.item.priority].icon}
                            </span>
                          )}
                          <span className="text-sm text-slate-700 truncate">{entry.item.title}</span>
                        </label>
                      ))}
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </div>
          )}
        </div>

        <DialogFooter>
          <DialogClose render={<Button variant="outline" size="sm" />}>
            Отмена
          </DialogClose>
          <Button size="sm" onClick={handleCreate} disabled={loading || !weekStart || !weekEnd}>
            {loading ? "Создание..." : "Создать"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

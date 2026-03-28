"use client";

import { useEffect } from "react";
import { useBrainStore } from "@/lib/store";
import type { WeeklyPlanEntryWithItem, Item, ItemCategory } from "@/types";
import { CATEGORY_CONFIG, PRIORITY_CONFIG, RESULT_STATUS_CONFIG } from "@/types";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogClose } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { CheckCircle2, XCircle, ArrowRight, Star, Loader2 } from "lucide-react";
import { formatWeekRange } from "./WeeklyPlanSelector";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  planId: string;
}

export function WeeklyReportDialog({ open, onOpenChange, planId }: Props) {
  const fetchPlanReport = useBrainStore((s) => s.fetchPlanReport);
  const report = useBrainStore((s) => s.currentPlanReport);

  useEffect(() => {
    if (open && planId) fetchPlanReport(planId);
  }, [open, planId, fetchPlanReport]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] max-h-[80vh] bg-white">
        {!report ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="size-6 text-slate-400 animate-spin" />
          </div>
        ) : (
        <>
        <DialogHeader>
          <DialogTitle>Отчёт за неделю: {formatWeekRange(report.plan)}</DialogTitle>
        </DialogHeader>

        <ScrollArea className="max-h-[60vh]">
          <div className="space-y-6 py-2">
            {/* Stats */}
            <div className="grid grid-cols-4 gap-3">
              <StatCard label="Всего" value={report.total} color="text-slate-700" bg="bg-slate-50" />
              <StatCard label="Выполнено" value={report.done_count} color="text-emerald-700" bg="bg-emerald-50" />
              <StatCard label="Не выполнено" value={report.not_done.length} color="text-red-700" bg="bg-red-50" />
              <StatCard label="Перенесено" value={report.transferred.length} color="text-amber-700" bg="bg-amber-50" />
            </div>

            {/* Completion rate */}
            <div className="px-3 py-2 bg-slate-50 rounded-lg">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-medium text-slate-500">Выполнение</span>
                <span className="text-sm font-bold text-slate-700">{report.completion_rate}%</span>
              </div>
              <div className="w-full h-2 bg-slate-200 rounded-full overflow-hidden">
                <div
                  className="h-full bg-emerald-500 rounded-full transition-all"
                  style={{ width: `${report.completion_rate}%` }}
                />
              </div>
            </div>

            {/* Done */}
            {report.done.length > 0 && (
              <ReportSection
                icon={<CheckCircle2 className="size-4 text-emerald-600" />}
                title="Выполнено"
                entries={report.done}
              />
            )}

            {/* Not done */}
            {report.not_done.length > 0 && (
              <ReportSection
                icon={<XCircle className="size-4 text-red-500" />}
                title="Не выполнено"
                entries={report.not_done}
              />
            )}

            {/* Transferred */}
            {report.transferred.length > 0 && (
              <ReportSection
                icon={<ArrowRight className="size-4 text-amber-500" />}
                title="Перенесено"
                entries={report.transferred}
              />
            )}

            {/* Unplanned done */}
            {report.unplanned_done.length > 0 && (
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <Star className="size-4 text-violet-500" />
                  <span className="text-sm font-semibold text-slate-700">Выполнено вне плана</span>
                  <span className="text-xs text-slate-400">({report.unplanned_done.length})</span>
                </div>
                <div className="space-y-1 ml-6">
                  {report.unplanned_done.map((item) => (
                    <UnplannedItemRow key={item.id} item={item} />
                  ))}
                </div>
              </div>
            )}
          </div>
        </ScrollArea>

        <div className="flex justify-end pt-2">
          <DialogClose render={<Button variant="outline" size="sm" />}>
            Закрыть
          </DialogClose>
        </div>
        </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function StatCard({ label, value, color, bg }: { label: string; value: number; color: string; bg: string }) {
  return (
    <div className={cn("rounded-lg px-3 py-2 text-center", bg)}>
      <p className={cn("text-2xl font-bold tabular-nums", color)}>{value}</p>
      <p className="text-[10px] text-slate-500 font-medium">{label}</p>
    </div>
  );
}

function ReportSection({ icon, title, entries }: { icon: React.ReactNode; title: string; entries: WeeklyPlanEntryWithItem[] }) {
  // Group by category
  const byCategory: Partial<Record<ItemCategory, WeeklyPlanEntryWithItem[]>> = {};
  for (const entry of entries) {
    const cat = entry.item.category;
    if (!byCategory[cat]) byCategory[cat] = [];
    byCategory[cat]!.push(entry);
  }

  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        {icon}
        <span className="text-sm font-semibold text-slate-700">{title}</span>
        <span className="text-xs text-slate-400">({entries.length})</span>
      </div>
      <div className="space-y-2 ml-6">
        {Object.entries(byCategory).map(([cat, catEntries]) => (
          <div key={cat}>
            <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-0.5">
              {CATEGORY_CONFIG[cat as ItemCategory].label}
            </p>
            {catEntries!.map((entry) => (
              <div key={entry.id} className="flex items-center gap-2 py-0.5">
                {entry.item.priority !== "none" && (
                  <span className={cn("text-xs", PRIORITY_CONFIG[entry.item.priority].color)}>
                    {PRIORITY_CONFIG[entry.item.priority].icon}
                  </span>
                )}
                <span className="text-sm text-slate-700">{entry.item.title}</span>
                {entry.result_comment && (
                  <span className="text-xs text-slate-400 italic truncate">— {entry.result_comment}</span>
                )}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function UnplannedItemRow({ item }: { item: Item }) {
  return (
    <div className="flex items-center gap-2 py-0.5">
      {item.priority !== "none" && (
        <span className={cn("text-xs", PRIORITY_CONFIG[item.priority].color)}>
          {PRIORITY_CONFIG[item.priority].icon}
        </span>
      )}
      <span className="text-sm text-slate-700">{item.title}</span>
      <span className="text-[10px] text-slate-400">
        {CATEGORY_CONFIG[item.category].label}
      </span>
    </div>
  );
}

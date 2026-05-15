"use client";

import { useEffect, useState } from "react";
import { CalendarDays, Plus, Loader2 } from "lucide-react";
import { useBrainStore } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { WeeklyPlanHeader } from "./WeeklyPlanHeader";
import { WeeklyTriageView } from "./WeeklyTriageView";
import { WeeklyReviewTable } from "./WeeklyReviewTable";
import { CreatePlanDialog } from "./CreatePlanDialog";
import { WeeklyReportDialog } from "./WeeklyReportDialog";

export type PlanViewMode = "triage" | "review";

export function WeeklyView() {
  const fetchWeeklyPlans = useBrainStore((s) => s.fetchWeeklyPlans);
  const fetchCurrentPlan = useBrainStore((s) => s.fetchCurrentPlan);
  const weeklyPlans = useBrainStore((s) => s.weeklyPlans);
  const currentPlan = useBrainStore((s) => s.currentPlan);
  const currentPlanId = useBrainStore((s) => s.currentPlanId);

  const [planViewMode, setPlanViewMode] = useState<PlanViewMode>("triage");
  const [createOpen, setCreateOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await fetchWeeklyPlans();
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [fetchWeeklyPlans]);

  useEffect(() => {
    if (loading) return;
    if (currentPlanId && !currentPlan) {
      fetchCurrentPlan(currentPlanId);
    } else if (!currentPlan && !currentPlanId && weeklyPlans.length > 0) {
      fetchCurrentPlan(weeklyPlans[0].id);
    }
  }, [loading, weeklyPlans, currentPlan, currentPlanId, fetchCurrentPlan]);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="size-6 text-slate-400 animate-spin" />
      </div>
    );
  }

  if (!currentPlan && weeklyPlans.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-4 text-center p-8">
        <CalendarDays className="size-12 text-slate-300" />
        <div>
          <h2 className="text-lg font-semibold text-slate-700 mb-1">Недельное планирование</h2>
          <p className="text-sm text-slate-400 max-w-md">
            Создайте план на неделю, чтобы распределять задачи и отслеживать прогресс.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)} className="gap-2">
          <Plus className="size-4" />
          Создать план на эту неделю
        </Button>
        <CreatePlanDialog open={createOpen} onOpenChange={setCreateOpen} />
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {currentPlan ? (
        <>
          <WeeklyPlanHeader
            plan={currentPlan}
            viewMode={planViewMode}
            onViewModeChange={setPlanViewMode}
            onShowReport={() => setReportOpen(true)}
            onCreateNew={() => setCreateOpen(true)}
          />

          {planViewMode === "triage" ? (
            <WeeklyTriageView plan={currentPlan} />
          ) : (
            <WeeklyReviewTable plan={currentPlan} />
          )}

          <WeeklyReportDialog
            open={reportOpen}
            onOpenChange={setReportOpen}
            planId={currentPlan.id}
          />
        </>
      ) : (
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="size-5 text-slate-400 animate-spin" />
        </div>
      )}

      <CreatePlanDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}

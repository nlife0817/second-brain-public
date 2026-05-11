"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import type { PlanningInitiative, PlanningInitiativeDependency, PlanningPeriod } from "@/types/planning";
import { usePlanningStore } from "@/lib/planning-store";

const TYPE_LANE: Record<PlanningInitiative["type"], string> = {
  client_blocker: "Блокер клиента",
  product_maturity: "Развитие",
  tech_debt: "Тех. долг",
  experiment: "Эксперимент",
  support: "Поддержка",
};

const STATUS_COLOR: Record<PlanningInitiative["status"], string> = {
  planned: "#94a3b8",
  in_progress: "#2563eb",
  done: "#16a34a",
  killed: "#374151",
};

interface Props {
  initiatives: PlanningInitiative[];
  periods: PlanningPeriod[];
}

interface BarRect { id: string; left: number; right: number; top: number; bottom: number; }

export function RoadmapGantt({ initiatives, periods }: Props) {
  const [allDeps, setAllDeps] = useState<PlanningInitiativeDependency[]>([]);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragRight, setDragRight] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const barRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const [barRects, setBarRects] = useState<BarRect[]>([]);
  const openDetail = usePlanningStore((s) => s.openInitiativeDetail);
  const refresh = usePlanningStore((s) => s.fetchAll);

  useEffect(() => {
    Promise.all(initiatives.map((i) =>
      fetch(`/api/planning/initiatives/${i.id}/dependencies`).then((r) => r.ok ? r.json() : [])
    )).then((rows) => setAllDeps(rows.flat()));
  }, [initiatives]);

  const dates = useMemo(() => initiatives.flatMap((i) => {
    const period = periods.find((p) => p.id === i.due_period_id);
    return [i.created_at, period?.end_date].filter(Boolean) as string[];
  }), [initiatives, periods]);
  const minDate = dates.reduce((a, b) => (a < b ? a : b), dates[0] ?? new Date().toISOString());
  const maxDate = dates.reduce((a, b) => (a > b ? a : b), dates[0] ?? new Date().toISOString());
  const minTs = new Date(minDate).getTime();
  const maxTs = new Date(maxDate).getTime();
  const totalDays = Math.max(1, Math.ceil((maxTs - minTs) / 86400000));

  const lanes = Array.from(new Set(initiatives.map((i) => i.type)));

  // Compute bar bounding rectangles after render for SVG overlay.
  // Async via rAF to avoid the "setState in effect" lint rule.
  useLayoutEffect(() => {
    const id = requestAnimationFrame(() => {
      if (!containerRef.current) return;
      const containerBox = containerRef.current.getBoundingClientRect();
      const rects: BarRect[] = [];
      for (const [bid, el] of barRefs.current.entries()) {
        const r = el.getBoundingClientRect();
        rects.push({
          id: bid,
          left: r.left - containerBox.left,
          right: r.right - containerBox.left,
          top: r.top - containerBox.top,
          bottom: r.bottom - containerBox.top,
        });
      }
      setBarRects(rects);
    });
    return () => cancelAnimationFrame(id);
  }, [initiatives, periods, allDeps, draggingId]);

  // Drag-resize handlers.
  useEffect(() => {
    if (!draggingId) return;
    const onMove = (e: MouseEvent) => {
      if (!containerRef.current) return;
      const box = containerRef.current.getBoundingClientRect();
      setDragRight(e.clientX - box.left);
    };
    const onUp = async (e: MouseEvent) => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      const id = draggingId;
      setDraggingId(null);
      if (!containerRef.current || !id) return;
      const box = containerRef.current.getBoundingClientRect();
      const x = e.clientX - box.left;
      // Map x position back to a target end date by laneRow.
      // We approximate the lane row by reusing the percent of container width.
      const ini = initiatives.find((i) => i.id === id);
      if (!ini) return;
      // Find the rect of this bar to derive percent inside its row.
      const bar = barRects.find((b) => b.id === id);
      if (!bar) return;
      // Estimate target end timestamp by horizontal position relative to lane width.
      // Lane begins at the same left as initial bar.left - bar.left = 0; lane spans roughly to container right.
      // Translate x to a fraction of the visible width and map to timestamp.
      const fraction = Math.max(0, Math.min(1, x / box.width));
      const targetTs = minTs + fraction * (maxTs - minTs);
      // Snap to nearest period end_date in the same direction.
      const candidatePeriods = periods.filter((p) => p.type === "week" || p.type === "month" || p.type === "quarter");
      let nearest = candidatePeriods[0];
      let nearestDiff = Infinity;
      for (const p of candidatePeriods) {
        const d = Math.abs(new Date(p.end_date).getTime() - targetTs);
        if (d < nearestDiff) { nearest = p; nearestDiff = d; }
      }
      if (!nearest || nearest.id === ini.due_period_id) {
        setDragRight(null);
        return;
      }
      // Persist with replan_reason=scope_underestimated (concept §6.7.6 suggestion).
      const res = await fetch(`/api/planning/initiatives/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          due_period_id: nearest.id,
          replan_reason: { code: "scope_underestimated" },
        }),
      });
      if (!res.ok) toast.error("Не удалось перенести дедлайн");
      else { toast.success("Дедлайн перенесён"); refresh(); }
      setDragRight(null);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [draggingId, initiatives, periods, minTs, maxTs, refresh, barRects]);

  if (initiatives.length === 0) {
    return <p className="p-8 text-center text-sm text-slate-500">Инициатив пока нет.</p>;
  }

  // Map for B → B' parent chains.
  const parentMap = initiatives.filter((i) => i.parent_initiative_id);

  const idToRect = new Map(barRects.map((r) => [r.id, r]));

  return (
    <div ref={containerRef} className="relative overflow-x-auto rounded-xl border border-slate-200 bg-white p-4">
      <p className="mb-3 text-xs text-slate-500">
        {minDate.slice(0, 10)} → {maxDate.slice(0, 10)} · {totalDays} дней · Потяните правый край полосы, чтобы перенести дедлайн
      </p>

      <div className="flex flex-col gap-2">
        {lanes.map((lane) => {
          const items = initiatives.filter((i) => i.type === lane);
          return (
            <div key={lane} className="flex items-stretch gap-3">
              <div className="w-32 shrink-0 text-xs font-semibold text-slate-600">
                {TYPE_LANE[lane]}
              </div>
              <div className="relative h-12 flex-1 rounded-md bg-slate-50">
                {items.map((i) => {
                  const period = periods.find((p) => p.id === i.due_period_id);
                  const startTs = new Date(i.created_at).getTime();
                  const endTs = period ? new Date(period.end_date).getTime() : startTs + 7 * 86400000;
                  const left = ((startTs - minTs) / (maxTs - minTs)) * 100;
                  const width = Math.max(2, ((endTs - startTs) / (maxTs - minTs)) * 100);
                  return (
                    <div
                      key={i.id}
                      ref={(el) => { if (el) barRefs.current.set(i.id, el); else barRefs.current.delete(i.id); }}
                      title={`${i.title} (${i.status})`}
                      onClick={() => openDetail(i.id)}
                      className="absolute top-1 flex h-10 cursor-pointer items-center overflow-hidden rounded-md px-2 text-[10px] text-white hover:ring-2 hover:ring-blue-300"
                      style={{ left: `${left}%`, width: `${width}%`, background: STATUS_COLOR[i.status] }}
                    >
                      <span className="truncate flex-1">{i.title}</span>
                      <span
                        role="button"
                        aria-label="Перенести дедлайн"
                        onMouseDown={(e) => { e.stopPropagation(); setDraggingId(i.id); }}
                        className="ml-1 h-full w-1.5 cursor-col-resize bg-white/30 hover:bg-white/60"
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* SVG overlay: arrows for dependencies + B → B' parent chain. */}
      <svg
        className="pointer-events-none absolute inset-0 h-full w-full"
        style={{ position: "absolute" }}
      >
        <defs>
          <marker id="arr" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto">
            <path d="M 0 0 L 10 5 L 0 10 Z" fill="#475569" />
          </marker>
          <marker id="arrChain" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto">
            <path d="M 0 0 L 10 5 L 0 10 Z" fill="#7c3aed" />
          </marker>
        </defs>

        {/* Dependencies: i depends on j → arrow from j.right → i.left. */}
        {allDeps.map((dep, idx) => {
          const from = idToRect.get(dep.depends_on_initiative_id);
          const to = idToRect.get(dep.initiative_id);
          if (!from || !to) return null;
          const x1 = from.right;
          const y1 = (from.top + from.bottom) / 2;
          const x2 = to.left;
          const y2 = (to.top + to.bottom) / 2;
          return (
            <line key={`d-${idx}`} x1={x1} y1={y1} x2={x2} y2={y2}
                  stroke="#475569" strokeWidth={1.5} strokeDasharray="4 3" markerEnd="url(#arr)" />
          );
        })}

        {/* B → B' parent chain (dashed purple). */}
        {parentMap.map((child) => {
          const from = idToRect.get(child.parent_initiative_id!);
          const to = idToRect.get(child.id);
          if (!from || !to) return null;
          const x1 = from.right;
          const y1 = (from.top + from.bottom) / 2;
          const x2 = to.left;
          const y2 = (to.top + to.bottom) / 2;
          return (
            <line key={`p-${child.id}`} x1={x1} y1={y1} x2={x2} y2={y2}
                  stroke="#7c3aed" strokeWidth={1.5} strokeDasharray="2 4" markerEnd="url(#arrChain)" />
          );
        })}

        {/* Drag preview line */}
        {draggingId && dragRight !== null && (() => {
          const bar = idToRect.get(draggingId);
          if (!bar) return null;
          return (
            <line x1={bar.right} y1={(bar.top + bar.bottom) / 2}
                  x2={dragRight} y2={(bar.top + bar.bottom) / 2}
                  stroke="#2563eb" strokeWidth={2} strokeDasharray="3 3" />
          );
        })()}
      </svg>
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import type { PlanningInitiative, PlanningPeriod } from "@/types/planning";

const RoadmapGantt = dynamic(
  () => import("@/components/planning/RoadmapGantt").then((m) => m.RoadmapGantt),
  { ssr: false, loading: () => <div className="rounded-xl border border-slate-200 bg-slate-50 p-8 text-center text-sm text-slate-500">Загрузка roadmap…</div> }
);

export default function RoadmapPage() {
  const [initiatives, setInitiatives] = useState<PlanningInitiative[]>([]);
  const [periods, setPeriods] = useState<PlanningPeriod[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    Promise.all([
      fetch("/api/planning/initiatives?include_archived=1").then((r) => r.ok ? r.json() : []),
      fetch("/api/planning/periods").then((r) => r.ok ? r.json() : []),
    ]).then(([inis, ps]) => { setInitiatives(inis); setPeriods(ps); setLoaded(true); });
  }, []);

  return (
    <div className="p-6">
      <h1 className="mb-4 text-2xl font-semibold">Roadmap</h1>
      {loaded ? <RoadmapGantt initiatives={initiatives} periods={periods} /> : null}
    </div>
  );
}

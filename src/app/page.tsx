"use client";

import { useEffect } from "react";
import { useBrainStore } from "@/lib/store";
import { Sidebar } from "@/components/layout/Sidebar";
import { Header } from "@/components/layout/Header";
import { KanbanBoard } from "@/components/kanban/Board";
import { ListView } from "@/components/list/ListView";
import { WeeklyView } from "@/components/weekly/WeeklyView";
import { TaskDetailModal, TaskDetailPanel } from "@/components/task/TaskDetailSheet";
import { CreateTaskDialog } from "@/components/task/CreateTaskDialog";

export default function Home() {
  const fetchItems = useBrainStore((s) => s.fetchItems);
  const fetchTags = useBrainStore((s) => s.fetchTags);
  const viewMode = useBrainStore((s) => s.viewMode);
  const detailMode = useBrainStore((s) => s.detailMode);
  const isDetailOpen = useBrainStore((s) => s.isDetailOpen);

  useEffect(() => {
    fetchItems();
    fetchTags();
  }, [fetchItems, fetchTags]);

  return (
    <div className="flex h-screen bg-background">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <Header />
        <div className="flex-1 flex min-h-0">
          {/* Main content — gets narrower when panel is open */}
          <main className="flex-1 overflow-auto min-w-0">
            {viewMode === "weekly" ? <WeeklyView /> : viewMode === "kanban" ? <KanbanBoard /> : <ListView />}
          </main>
          {/* Inline panel (only when mode=panel and detail is open) */}
          {detailMode === "panel" && isDetailOpen && <TaskDetailPanel />}
        </div>
      </div>
      {/* Modal (only when mode=modal) */}
      {detailMode === "modal" && <TaskDetailModal />}
      <CreateTaskDialog />
    </div>
  );
}

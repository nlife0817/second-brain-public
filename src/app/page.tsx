"use client";

import { useEffect } from "react";
import { useBrainStore } from "@/lib/store";
import { Sidebar } from "@/components/layout/Sidebar";
import { Header } from "@/components/layout/Header";
import { FilterBar } from "@/components/filters/FilterBar";
import { KanbanBoard } from "@/components/kanban/Board";
import { ListView } from "@/components/list/ListView";
import { TaskDetailSheet } from "@/components/task/TaskDetailSheet";
import { CreateTaskDialog } from "@/components/task/CreateTaskDialog";

export default function Home() {
  const fetchItems = useBrainStore((s) => s.fetchItems);
  const fetchTags = useBrainStore((s) => s.fetchTags);
  const viewMode = useBrainStore((s) => s.viewMode);

  useEffect(() => {
    fetchItems();
    fetchTags();
  }, [fetchItems, fetchTags]);

  return (
    <div className="flex h-screen bg-background">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <Header />
        <FilterBar />
        <main className="flex-1 overflow-hidden">
          {viewMode === "kanban" ? <KanbanBoard /> : <ListView />}
        </main>
      </div>
      <TaskDetailSheet />
      <CreateTaskDialog />
    </div>
  );
}

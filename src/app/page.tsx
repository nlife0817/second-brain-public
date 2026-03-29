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
import { ClientsView } from "@/components/clients/ClientsView";
import { ClientDetailModal, ClientDetailPanel } from "@/components/clients/ClientDetailModal";
import { CreateClientDialog } from "@/components/clients/CreateClientDialog";
import { SettingsView } from "@/components/settings/SettingsView";
import { StagingView } from "@/components/staging/StagingView";

export default function Home() {
  const fetchItems = useBrainStore((s) => s.fetchItems);
  const fetchTags = useBrainStore((s) => s.fetchTags);
  const fetchCategories = useBrainStore((s) => s.fetchCategories);
  const fetchClients = useBrainStore((s) => s.fetchClients);
  const fetchClientStatuses = useBrainStore((s) => s.fetchClientStatuses);
  const fetchRelationTypes = useBrainStore((s) => s.fetchRelationTypes);
  const fetchEntityCounts = useBrainStore((s) => s.fetchEntityCounts);
  const fetchStagingItems = useBrainStore((s) => s.fetchStagingItems);
  const viewMode = useBrainStore((s) => s.viewMode);
  const detailMode = useBrainStore((s) => s.detailMode);
  const isDetailOpen = useBrainStore((s) => s.isDetailOpen);
  const isClientDetailOpen = useBrainStore((s) => s.isClientDetailOpen);
  const appSection = useBrainStore((s) => s.appSection);

  useEffect(() => {
    fetchItems();
    fetchTags();
    fetchCategories();
    fetchClients();
    fetchClientStatuses();
    fetchRelationTypes();
    fetchEntityCounts("item");
    fetchEntityCounts("client");
    fetchStagingItems();
  }, [fetchItems, fetchTags, fetchCategories, fetchClients, fetchClientStatuses, fetchRelationTypes, fetchEntityCounts, fetchStagingItems]);

  return (
    <div className="flex h-screen bg-background">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        {appSection === "tasks" && <Header />}
        <div className="flex-1 flex min-h-0">
          <main className="flex-1 overflow-auto min-w-0">
            {appSection === "settings" ? (
              <SettingsView />
            ) : appSection === "staging" ? (
              <StagingView />
            ) : appSection === "clients" ? (
              <ClientsView />
            ) : viewMode === "weekly" ? (
              <WeeklyView />
            ) : viewMode === "kanban" ? (
              <KanbanBoard />
            ) : (
              <ListView />
            )}
          </main>
          {appSection === "tasks" && detailMode === "panel" && isDetailOpen && <TaskDetailPanel />}
          {appSection === "clients" && detailMode === "panel" && isClientDetailOpen && <ClientDetailPanel />}
        </div>
      </div>
      {appSection === "tasks" && detailMode === "modal" && <TaskDetailModal />}
      {appSection === "tasks" && <CreateTaskDialog />}
      {appSection === "clients" && <ClientDetailModal />}
      {appSection === "clients" && <CreateClientDialog />}
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/core/client";
import type { TaskDetail, TaskPriority, UserBrief } from "@/lib/core/types";
import { useV2Store, useV2StoreApi } from "@/lib/core/ui-store";
import { MemberPicker } from "./MemberPicker";
import { PRIORITY_LABELS } from "./bits";

export function CreateTaskDialog({
  open,
  onOpenChange,
  projectId,
  statusId,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Проект, в который создаём (undefined — личный инбокс). */
  projectId?: string;
  statusId?: string | null;
  onCreated?: (task: TaskDetail) => void;
}) {
  const { orgId, statuses } = useV2Store();
  const storeApi = useV2StoreApi();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<TaskPriority>("none");
  const [dueDate, setDueDate] = useState("");
  const [status, setStatus] = useState<string | null>(statusId ?? null);
  const [assignees, setAssignees] = useState<UserBrief[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Диалог остаётся смонтированным между открытиями: подхватываем колонку,
  // из которой его открыли, иначе задача уедет в статус прошлого раза.
  useEffect(() => {
    if (open) setStatus(statusId ?? null);
  }, [open, statusId]);

  async function submit() {
    if (!orgId || !title.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      const task = await api.post<TaskDetail>(`/orgs/${orgId}/tasks`, {
        title: title.trim(),
        // Описание хранится как HTML (Tiptap), поэтому оборачиваем сразу —
        // иначе первое открытие карточки даст ложное «изменил описание».
        description: description.trim()
          ? description
              .split(/\n{2,}/)
              .map(
                (block) =>
                  `<p>${block
                    .split("\n")
                    .map((s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"))
                    .join("<br>")}</p>`,
              )
              .join("")
          : undefined,
        priority,
        due_date: dueDate || null,
        status_id: status ?? statusId ?? statuses.find((s) => s.kind === "open")?.id ?? null,
        placements: projectId ? [{ project_id: projectId }] : undefined,
        assignee_ids: assignees.map((a) => a.id),
      });
      onCreated?.(task);
      onOpenChange(false);
      setTitle("");
      setDescription("");
      setPriority("none");
      setDueDate("");
      setAssignees([]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось создать задачу");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Новая задача</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <Input
            autoFocus
            placeholder="Что нужно сделать?"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void submit()}
          />
          <Textarea
            placeholder="Описание (необязательно)"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="min-h-20"
          />
          <div className="flex flex-wrap items-center gap-2">
            <Select value={status ?? ""} onValueChange={(v) => setStatus(v || null)}>
              <SelectTrigger size="sm" className="w-fit min-w-32">
                <SelectValue placeholder="Статус">
                  {statuses.find((s) => s.id === status)?.name ?? "Статус"}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {statuses.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={priority} onValueChange={(v) => v && setPriority(v as TaskPriority)}>
              <SelectTrigger size="sm" className="w-fit min-w-32">
                <SelectValue>{PRIORITY_LABELS[priority].label}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(PRIORITY_LABELS) as TaskPriority[]).map((p) => (
                  <SelectItem key={p} value={p}>
                    {PRIORITY_LABELS[p].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="h-7 rounded-md border border-border bg-background px-2 text-sm"
            />
            <MemberPicker selected={assignees} projectIds={projectId ? [projectId] : []} onChange={(ids) => {
              const { members } = storeApi.getState();
              setAssignees(
                ids
                  .map((id) => members.find((m) => m.user_id === id))
                  .filter(Boolean)
                  .map((m) => ({ id: m!.user_id, email: m!.email, name: m!.name, avatar_url: m!.avatar_url })),
              );
            }} />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Отмена
            </Button>
            <Button onClick={() => void submit()} disabled={!title.trim() || saving}>
              {saving ? "Создание…" : "Создать"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

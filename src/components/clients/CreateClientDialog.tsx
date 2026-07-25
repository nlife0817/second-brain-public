"use client";

import { useState, useCallback, useEffect } from "react";
import { useBrainStore } from "@/lib/store";
import type { ClientStatus } from "@/types";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

import { Plus } from "lucide-react";

export function CreateClientDialog() {
  const isCreateClientOpen = useBrainStore((s) => s.isCreateClientOpen);
  const closeCreateClient = useBrainStore((s) => s.closeCreateClient);
  const createClient = useBrainStore((s) => s.createClient);
  const openClientDetail = useBrainStore((s) => s.openClientDetail);
  const clientStatuses = useBrainStore((s) => s.clientStatuses);

  const [name, setName] = useState("");
  const [statusId, setStatusId] = useState<string>("");
  const [companyName, setCompanyName] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Reset form when dialog opens
  useEffect(() => {
    if (isCreateClientOpen) {
      setName("");
      setStatusId("");
      setCompanyName("");
      setIsSubmitting(false);
    }
  }, [isCreateClientOpen]);

  const handleSubmit = useCallback(async () => {
    const trimmedName = name.trim();
    if (!trimmedName || isSubmitting) return;

    setIsSubmitting(true);
    try {
      const trimmedCompany = companyName.trim();
      const client = await createClient({
        name: trimmedName,
        status_id: statusId || null,
        companies: trimmedCompany ? [{ name: trimmedCompany }] : [],
      });
      closeCreateClient();
      openClientDetail(client.id);
    } catch {
      // Keep dialog open on error so user can retry
    } finally {
      setIsSubmitting(false);
    }
  }, [name, companyName, statusId, isSubmitting, createClient, closeCreateClient, openClientDetail]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit]
  );

  const sortedStatuses = clientStatuses.slice().sort(
    (a: ClientStatus, b: ClientStatus) => a.position - b.position
  );

  const selectedStatus = clientStatuses.find(
    (s: ClientStatus) => s.id === statusId
  );

  return (
    <Dialog
      open={isCreateClientOpen}
      onOpenChange={(open) => {
        if (!open) closeCreateClient();
      }}
    >
      <DialogContent
        className="border-slate-200 bg-white sm:max-w-md"
        onKeyDown={handleKeyDown}
      >
        <DialogHeader>
          <DialogTitle className="text-slate-900">
            Создать клиента
          </DialogTitle>
          <DialogDescription className="sr-only">
            Заполните поля для создания нового клиента
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          {/* Client name */}
          <Input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Название клиента..."
            className="border-slate-200 bg-white text-base font-medium text-slate-900 placeholder:text-slate-400"
          />

          {/* Status selector */}
          {sortedStatuses.length > 0 && (
            <Select
              value={statusId}
              onValueChange={(v) => setStatusId(v ?? "")}
            >
              <SelectTrigger
                size="sm"
                className="w-auto border-slate-200 bg-white"
              >
                <SelectValue placeholder="Статус">
                  {selectedStatus ? (
                    <span className="inline-flex items-center gap-1.5">
                      <span
                        className="inline-block size-2 rounded-full"
                        style={{ backgroundColor: selectedStatus.color }}
                      />
                      {selectedStatus.name}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">Статус</span>
                  )}
                </SelectValue>
              </SelectTrigger>
              <SelectContent className="border-slate-200 bg-white">
                {sortedStatuses.map((status: ClientStatus) => (
                  <SelectItem key={status.id} value={status.id}>
                    <span className="inline-flex items-center gap-1.5">
                      <span
                        className="inline-block size-2 rounded-full"
                        style={{ backgroundColor: status.color }}
                      />
                      {status.name}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          {/* Initial company name */}
          <Input
            value={companyName}
            onChange={(e) => setCompanyName(e.target.value)}
            placeholder="Компания (опционально)"
            className="border-slate-200 bg-white text-sm text-slate-900 placeholder:text-slate-400"
          />
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={closeCreateClient}
            className="border-slate-200"
          >
            Отмена
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!name.trim() || isSubmitting}
          >
            <Plus className="size-4" />
            Создать
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

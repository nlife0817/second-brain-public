"use client";

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  itemId: string;
  onCreated: () => void;
}

/** datetime-local format: YYYY-MM-DDTHH:MM */
function nowLocalIso(offsetMin = 0): string {
  const d = new Date(Date.now() + offsetMin * 60_000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function localToIsoUtc(local: string): string | null {
  const d = new Date(local);
  if (isNaN(d.getTime())) return null;
  return d.toISOString();
}

export function ManualEntryDialog({ open, onOpenChange, itemId, onCreated }: Props) {
  const [startedLocal, setStartedLocal] = useState(() => nowLocalIso(-60));
  const [endedLocal, setEndedLocal] = useState(() => nowLocalIso(0));
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setStartedLocal(nowLocalIso(-60));
      setEndedLocal(nowLocalIso(0));
      setNote("");
      setError(null);
    }
  }, [open]);

  const handleSubmit = async () => {
    setError(null);
    const startIso = localToIsoUtc(startedLocal);
    const endIso = localToIsoUtc(endedLocal);
    if (!startIso || !endIso) {
      setError("Некорректные даты");
      return;
    }
    if (new Date(endIso) <= new Date(startIso)) {
      setError("Конец должен быть позже начала");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/timing/entries", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          item_id: itemId,
          started_at: startIso,
          ended_at: endIso,
          note: note.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? `Ошибка ${res.status}`);
        return;
      }
      onCreated();
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Добавить сессию вручную</DialogTitle>
          <DialogDescription>
            Запиши задним числом, если забыл включить таймер.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <label className="block text-xs">
            <span className="text-slate-600">Начало</span>
            <Input
              type="datetime-local"
              value={startedLocal}
              onChange={(e) => setStartedLocal(e.target.value)}
              className="mt-1"
            />
          </label>
          <label className="block text-xs">
            <span className="text-slate-600">Конец</span>
            <Input
              type="datetime-local"
              value={endedLocal}
              onChange={(e) => setEndedLocal(e.target.value)}
              className="mt-1"
            />
          </label>
          <label className="block text-xs">
            <span className="text-slate-600">Заметка (необязательно)</span>
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Что делал…"
              rows={2}
              className="mt-1"
            />
          </label>
          {error && <div className="text-xs text-red-500">{error}</div>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Отмена
          </Button>
          <Button onClick={handleSubmit} disabled={busy}>
            {busy ? "Сохранение…" : "Сохранить"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

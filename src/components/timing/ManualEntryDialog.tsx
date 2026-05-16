"use client";

import { useMemo, useState } from "react";
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

function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function localToDate(local: string): Date | null {
  const d = new Date(local);
  return Number.isNaN(d.getTime()) ? null : d;
}

function addMinutesLocal(startLocal: string, durationMin: number): string {
  const start = localToDate(startLocal);
  if (!start) return "";
  return toLocalInput(new Date(start.getTime() + durationMin * 60_000));
}

function defaultStartLocal(): string {
  return toLocalInput(new Date(Date.now() - 60 * 60_000));
}

export function ManualEntryDialog({ open, onOpenChange, itemId, onCreated }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && (
        <ManualEntryForm
          key={`${itemId}:${open ? "open" : "closed"}`}
          itemId={itemId}
          onCancel={() => onOpenChange(false)}
          onCreated={() => {
            onCreated();
            onOpenChange(false);
          }}
        />
      )}
    </Dialog>
  );
}

function ManualEntryForm({
  itemId,
  onCancel,
  onCreated,
}: {
  itemId: string;
  onCancel: () => void;
  onCreated: () => void;
}) {
  const [startedLocal, setStartedLocal] = useState(defaultStartLocal);
  const [durationMin, setDurationMin] = useState("60");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const parsedDuration = Number.parseInt(durationMin, 10);
  const endedLocal = useMemo(
    () => addMinutesLocal(startedLocal, Number.isFinite(parsedDuration) ? parsedDuration : 0),
    [startedLocal, parsedDuration],
  );

  const handleSubmit = async () => {
    setError(null);
    const started = localToDate(startedLocal);
    if (!started || !Number.isFinite(parsedDuration) || parsedDuration <= 0) {
      setError("Укажи корректное начало и длительность больше 0 минут");
      return;
    }
    const ended = new Date(started.getTime() + parsedDuration * 60_000);

    setBusy(true);
    try {
      const res = await fetch("/api/timing/entries", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          item_id: itemId,
          started_at: started.toISOString(),
          ended_at: ended.toISOString(),
          note: note.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? `Ошибка ${res.status}`);
        return;
      }
      onCreated();
    } finally {
      setBusy(false);
    }
  };

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Добавить сессию вручную</DialogTitle>
        <DialogDescription>
          Укажи начало и длительность. Конец посчитается автоматически.
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
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-xs">
            <span className="text-slate-600">Длительность, мин</span>
            <Input
              type="number"
              min={1}
              step={5}
              value={durationMin}
              onChange={(e) => setDurationMin(e.target.value)}
              className="mt-1"
            />
          </label>
          <label className="block text-xs">
            <span className="text-slate-600">Конец</span>
            <Input value={endedLocal} readOnly className="mt-1 bg-slate-50 text-slate-500" />
          </label>
        </div>
        <label className="block text-xs">
          <span className="text-slate-600">Заметка</span>
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Что делал..."
            rows={2}
            className="mt-1"
          />
        </label>
        {error && <div className="text-xs text-red-500">{error}</div>}
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onCancel} disabled={busy}>
          Отмена
        </Button>
        <Button onClick={() => void handleSubmit()} disabled={busy}>
          {busy ? "Сохранение..." : "Сохранить"}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

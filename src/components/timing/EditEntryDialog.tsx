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
import type { TimeEntry } from "@/types";

interface Props {
  entry: TimeEntry | null;
  onClose: () => void;
  onSaved: () => void;
}

function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function localToDate(local: string): Date | null {
  const d = new Date(local);
  return Number.isNaN(d.getTime()) ? null : d;
}

function durationMinutes(entry: TimeEntry): number {
  if (!entry.ended_at) return 0;
  return Math.max(
    1,
    Math.round((new Date(entry.ended_at).getTime() - new Date(entry.started_at).getTime()) / 60_000),
  );
}

function addMinutesLocal(startLocal: string, durationMin: number): string {
  const start = localToDate(startLocal);
  if (!start) return "";
  return toLocalInput(new Date(start.getTime() + durationMin * 60_000));
}

export function EditEntryDialog({ entry, onClose, onSaved }: Props) {
  return (
    <Dialog open={entry !== null} onOpenChange={(open) => !open && onClose()}>
      {entry && (
        <EditEntryForm
          key={entry.id}
          entry={entry}
          onCancel={onClose}
          onSaved={() => {
            onSaved();
            onClose();
          }}
        />
      )}
    </Dialog>
  );
}

function EditEntryForm({
  entry,
  onCancel,
  onSaved,
}: {
  entry: TimeEntry;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [startedLocal, setStartedLocal] = useState(() => toLocalInput(new Date(entry.started_at)));
  const [durationMin, setDurationMin] = useState(() => String(durationMinutes(entry)));
  const [note, setNote] = useState(entry.note);
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
      const res = await fetch(`/api/timing/entries/${entry.id}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          started_at: started.toISOString(),
          ended_at: ended.toISOString(),
          note,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? `Ошибка ${res.status}`);
        return;
      }
      onSaved();
    } finally {
      setBusy(false);
    }
  };

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Редактировать сессию</DialogTitle>
        <DialogDescription>
          Меняй начало и длительность. Конец пересчитается автоматически.
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

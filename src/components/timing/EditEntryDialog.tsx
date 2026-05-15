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
import type { TimeEntry } from "@/types";

interface Props {
  entry: TimeEntry | null;
  onClose: () => void;
  onSaved: () => void;
}

function isoToLocal(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function localToIsoUtc(local: string): string | null {
  const d = new Date(local);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

export function EditEntryDialog({ entry, onClose, onSaved }: Props) {
  const [startedLocal, setStartedLocal] = useState("");
  const [endedLocal, setEndedLocal] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!entry) return;
    setStartedLocal(isoToLocal(entry.started_at));
    setEndedLocal(entry.ended_at ? isoToLocal(entry.ended_at) : "");
    setNote(entry.note);
    setError(null);
  }, [entry]);

  const handleSubmit = async () => {
    if (!entry) return;
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
      const res = await fetch(`/api/timing/entries/${entry.id}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          started_at: startIso,
          ended_at: endIso,
          note,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? `Ошибка ${res.status}`);
        return;
      }
      onSaved();
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={entry !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Редактировать сессию</DialogTitle>
          <DialogDescription>
            Поправь время или заметку. Активную сессию редактировать нельзя: сначала останови таймер.
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
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Отмена
          </Button>
          <Button onClick={() => void handleSubmit()} disabled={busy}>
            {busy ? "Сохранение..." : "Сохранить"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

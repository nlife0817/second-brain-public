"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useTimingStore, formatHMS } from "@/lib/timing-store";
import type { ActiveTimerSnapshot } from "@/types";

const FAILSAFE_DISMISS_MS = 60_000;

export function IdleDialog() {
  const open = useTimingStore((s) => s.idlePromptOpen);
  const setOpen = useTimingStore((s) => s.setIdlePromptOpen);
  const activeEntry = useTimingStore((s) => s.activeEntry);
  const itemTitle = useTimingStore((s) => s.itemTitle);
  const lastActiveAt = useTimingStore((s) => s.lastActiveAt);
  const applySnapshot = useTimingStore((s) => s.applySnapshot);
  const hydrate = useTimingStore((s) => s.hydrate);

  const [busy, setBusy] = useState(false);

  // Snapshot the lastActiveAt at the moment the dialog became visible — that
  // value is the candidate cut point. Subsequent activity (e.g. clicking a
  // dialog button) would otherwise overwrite it.
  const cutAtIso = useMemo(() => (open ? lastActiveAt : null), [open, lastActiveAt]);

  const idleSeconds = useMemo(() => {
    if (!cutAtIso) return 0;
    return Math.max(0, Math.floor((Date.now() - new Date(cutAtIso).getTime()) / 1000));
  }, [cutAtIso]);

  // Failsafe: if user doesn't choose, auto-dismiss as "Keep" so we don't lose data.
  useEffect(() => {
    if (!open) return;
    const id = window.setTimeout(() => {
      setOpen(false);
    }, FAILSAFE_DISMISS_MS);
    return () => window.clearTimeout(id);
  }, [open, setOpen]);

  if (!activeEntry) return null;

  const callDiscard = async (restart: boolean) => {
    if (busy || !cutAtIso) return;
    setBusy(true);
    try {
      const res = await fetch("/api/timing/discard-idle", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cut_at: cutAtIso, restart }),
      });
      if (!res.ok) throw new Error(`discard-idle failed: ${res.status}`);
      const data = (await res.json()) as { snapshot: ActiveTimerSnapshot };
      applySnapshot(data.snapshot);
      setOpen(false);
    } catch (e) {
      console.error("[timing] discard-idle failed", e);
      // Re-sync from server.
      await hydrate();
    } finally {
      setBusy(false);
    }
  };

  const handleKeep = () => {
    if (busy) return;
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Ты ещё работаешь?</DialogTitle>
          <DialogDescription>
            Активности нет {formatHMS(idleSeconds)}. Таймер «{itemTitle ?? "задача"}»
            продолжает идти. Что сделать с этим временем?
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => callDiscard(false)}
            title="Закрыть таймер моментом последней активности"
          >
            Списать idle ({formatHMS(idleSeconds)})
          </Button>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => callDiscard(true)}
            title="Списать idle и сразу запустить новый таймер на этой же задаче"
          >
            Списать и продолжить
          </Button>
          <Button disabled={busy} onClick={handleKeep}>
            Это рабочее время
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

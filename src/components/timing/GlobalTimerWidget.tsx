"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { Play, Square, Search, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { useBrainStore } from "@/lib/store";
import { useTimingStore, formatHMS } from "@/lib/timing-store";
import type { ItemWithSubtasks } from "@/types";

function shouldHide(pathname: string | null): boolean {
  if (!pathname) return true;
  if (pathname === "/login") return true;
  if (pathname.startsWith("/auth/")) return true;
  // Mobile shell renders its own slim timer bar.
  if (pathname.startsWith("/m/")) return true;
  return false;
}

function useTickingElapsed(): number {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), 1000);
    return () => window.clearInterval(id);
  }, []);
  return useTimingStore.getState().elapsedSeconds();
}

export function GlobalTimerWidget() {
  const pathname = usePathname();
  const hidden = shouldHide(pathname);

  const activeEntry = useTimingStore((s) => s.activeEntry);
  const itemTitle = useTimingStore((s) => s.itemTitle);
  const hydrated = useTimingStore((s) => s.hydrated);
  const stop = useTimingStore((s) => s.stop);

  const [stopping, setStopping] = useState(false);

  const elapsed = useTickingElapsed();

  if (hidden || !hydrated) return null;

  const handleStop = async () => {
    if (stopping) return;
    setStopping(true);
    try {
      await stop();
    } catch (e) {
      console.error("[timing] stop failed", e);
    } finally {
      setStopping(false);
    }
  };

  return (
    <div
      data-slot="global-timer-widget"
      className={cn(
        "fixed bottom-4 right-4 z-50",
        "flex items-stretch gap-1 rounded-xl border border-border/60 bg-background/95 p-1 shadow-lg backdrop-blur",
      )}
    >
      {activeEntry ? (
        <>
          <div className="flex flex-col justify-center px-2.5 py-1 min-w-0">
            <span
              className="text-[11px] leading-tight text-muted-foreground truncate max-w-[180px]"
              title={itemTitle ?? undefined}
            >
              {itemTitle ?? "Задача"}
            </span>
            <span className="font-mono tabular-nums text-base leading-tight font-medium">
              {formatHMS(elapsed)}
            </span>
          </div>
          <SwitchTimerButton activeItemId={activeEntry.item_id} />
          <Button
            variant="destructive"
            size="icon"
            aria-label="Остановить таймер"
            onClick={handleStop}
            disabled={stopping}
          >
            {stopping ? <Loader2 className="animate-spin" /> : <Square />}
          </Button>
        </>
      ) : (
        <StartTimerButton />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Start (no active timer): popover with task search
// ---------------------------------------------------------------------------
function StartTimerButton() {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={(
          <Button variant="default" size="sm" aria-label="Запустить таймер">
            <Play /> Запустить
          </Button>
        )}
      />
      <PopoverContent align="end" side="top" className="w-80 p-0">
        <TaskPickerCommand
          onPick={() => setOpen(false)}
          mode="start"
        />
      </PopoverContent>
    </Popover>
  );
}

// ---------------------------------------------------------------------------
// Switch (active timer running): popover, picking will auto-stop+start
// ---------------------------------------------------------------------------
function SwitchTimerButton({ activeItemId }: { activeItemId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={(
          <Button variant="ghost" size="icon" aria-label="Переключить на другую задачу">
            <Search />
          </Button>
        )}
      />
      <PopoverContent align="end" side="top" className="w-80 p-0">
        <TaskPickerCommand
          onPick={() => setOpen(false)}
          mode="switch"
          activeItemId={activeItemId}
        />
      </PopoverContent>
    </Popover>
  );
}

// ---------------------------------------------------------------------------
// Task picker (uses items already loaded by useBrainStore)
// ---------------------------------------------------------------------------
function TaskPickerCommand(props: {
  onPick: () => void;
  mode: "start" | "switch";
  activeItemId?: string;
}) {
  const items = useBrainStore((s) => s.items);
  const start = useTimingStore((s) => s.start);
  const [busy, setBusy] = useState(false);

  // Top-of-mind: open / not-archived / not-done items, recent first.
  const candidates = useMemo<ItemWithSubtasks[]>(() => {
    const list = items
      .filter((it) => it.status !== "archived" && it.status !== "done")
      .filter((it) => it.id !== props.activeItemId);
    list.sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1));
    return list.slice(0, 50);
  }, [items, props.activeItemId]);

  const handlePick = async (item: ItemWithSubtasks) => {
    if (busy) return;
    setBusy(true);
    try {
      await start(item.id, { itemTitle: item.title });
      props.onPick();
    } catch (e) {
      console.error("[timing] start failed", e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Command>
      <CommandInput placeholder="Найти задачу…" />
      <CommandList>
        <CommandEmpty>
          {items.length === 0 ? "Задачи не загружены — открой раздел задач" : "Ничего не найдено"}
        </CommandEmpty>
        <CommandGroup heading={props.mode === "switch" ? "Переключиться на" : "Запустить таймер"}>
          {candidates.map((item) => (
            <CommandItem
              key={item.id}
              value={`${item.title} ${item.id}`}
              onSelect={() => handlePick(item)}
              disabled={busy}
            >
              <span className="truncate">{item.title || "(без названия)"}</span>
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </Command>
  );
}

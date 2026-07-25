"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  DevelopmentParticipantInput,
  KaitenStageOption,
  KaitenSyncCatalog,
} from "@/types";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Check, ChevronDown, Users } from "lucide-react";

const EMPTY_CATALOG: KaitenSyncCatalog = {
  development_stages: [],
  participants: [],
  profiles: [],
};

type ParticipantLike = Pick<
  DevelopmentParticipantInput,
  "provider" | "remote_id" | "name"
>;

function participantKey(participant: ParticipantLike) {
  const provider = participant.provider ?? "local";
  const remoteId = participant.remote_id?.trim();
  if (remoteId) return `${provider}:${remoteId}`;
  return `name:${participant.name.trim().toLowerCase()}`;
}

function normalizeParticipant(
  participant: ParticipantLike
): DevelopmentParticipantInput {
  return {
    provider: participant.provider ?? null,
    remote_id: participant.remote_id ?? null,
    name: participant.name,
  };
}

export function mergeStageOptions(
  options: KaitenStageOption[],
  value?: string | null
): KaitenStageOption[] {
  const map = new Map<string, KaitenStageOption>();
  for (const option of options) {
    map.set(option.value, option);
  }

  const current = value?.trim();
  if (current && !map.has(current)) {
    map.set(current, {
      value: current,
      label: current,
      column_id: null,
      lane_id: null,
      column_title: current,
      lane_title: null,
    });
  }

  return Array.from(map.values()).sort((a, b) =>
    a.label.localeCompare(b.label, "ru")
  );
}

export function mergeParticipantOptions(
  options: DevelopmentParticipantInput[],
  selected: ParticipantLike[] = []
): DevelopmentParticipantInput[] {
  const map = new Map<string, DevelopmentParticipantInput>();

  for (const option of options) {
    map.set(participantKey(option), normalizeParticipant(option));
  }

  for (const option of selected) {
    map.set(participantKey(option), normalizeParticipant(option));
  }

  return Array.from(map.values()).sort((a, b) =>
    a.name.localeCompare(b.name, "ru")
  );
}

export function formatParticipantsSummary(participants: ParticipantLike[] = []) {
  if (participants.length === 0) return "Без участников";
  if (participants.length === 1) return participants[0]?.name ?? "Без участников";
  return `${participants[0]?.name ?? "Участник"} +${participants.length - 1}`;
}

export function useKaitenCatalog() {
  const [catalog, setCatalog] = useState<KaitenSyncCatalog>(EMPTY_CATALOG);
  const [loading, setLoading] = useState(true);

  const fetchCatalog = useCallback(async () => {
    try {
      const response = await fetch("/api/kaiten/catalog", { cache: "no-store" });
      if (!response.ok) return;
      const payload = (await response.json()) as KaitenSyncCatalog;
      const normalized = {
        development_stages: payload.development_stages ?? [],
        participants: payload.participants ?? [],
        profiles: payload.profiles ?? [],
      };

      if (
        normalized.development_stages.length === 0
        && normalized.participants.length === 0
      ) {
        const refreshedResponse = await fetch("/api/kaiten/catalog?refresh=true", {
          cache: "no-store",
        });
        if (refreshedResponse.ok) {
          const refreshedPayload = (await refreshedResponse.json()) as KaitenSyncCatalog;
          setCatalog({
            development_stages: refreshedPayload.development_stages ?? [],
            participants: refreshedPayload.participants ?? [],
            profiles: refreshedPayload.profiles ?? [],
          });
          return;
        }
      }

      setCatalog(normalized);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchCatalog();
  }, [fetchCatalog]);

  return {
    catalog,
    loading,
    refresh: fetchCatalog,
  };
}

export function KaitenDevelopmentStageSelect({
  value,
  options,
  onChange,
  placeholder = "Не выбрано",
  className,
}: {
  value?: string | null;
  options: KaitenStageOption[];
  onChange: (value: string | null) => void;
  placeholder?: string;
  className?: string;
}) {
  const mergedOptions = useMemo(
    () => mergeStageOptions(options, value),
    [options, value]
  );
  const selectedLabel =
    mergedOptions.find((option) => option.value === value)?.label ?? placeholder;

  return (
    <Select
      value={value ?? "__none__"}
      onValueChange={(next) => onChange(next === "__none__" ? null : next)}
    >
      <SelectTrigger
        className={cn("h-8 w-full text-xs", className)}
        onClick={(event) => event.stopPropagation()}
      >
        <SelectValue>{selectedLabel}</SelectValue>
      </SelectTrigger>
      <SelectContent onClick={(event) => event.stopPropagation()}>
        <SelectItem value="__none__">{placeholder}</SelectItem>
        {mergedOptions.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function KaitenParticipantsSelect({
  value,
  options,
  onChange,
  placeholder = "Без участников",
  buttonClassName,
}: {
  value: ParticipantLike[];
  options: DevelopmentParticipantInput[];
  onChange: (participants: DevelopmentParticipantInput[]) => void;
  placeholder?: string;
  buttonClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const mergedOptions = useMemo(
    () => mergeParticipantOptions(options, value),
    [options, value]
  );

  const selectedKeys = useMemo(
    () => new Set(value.map((participant) => participantKey(participant))),
    [value]
  );

  const filteredOptions = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return mergedOptions;
    return mergedOptions.filter((participant) =>
      participant.name.toLowerCase().includes(normalizedQuery)
    );
  }, [mergedOptions, query]);

  const toggleParticipant = useCallback(
    (participant: DevelopmentParticipantInput) => {
      const key = participantKey(participant);
      if (selectedKeys.has(key)) {
        onChange(
          value
            .filter((entry) => participantKey(entry) !== key)
            .map(normalizeParticipant)
        );
        return;
      }

      onChange([...value.map(normalizeParticipant), normalizeParticipant(participant)]);
    },
    [onChange, selectedKeys, value]
  );

  const triggerLabel =
    value.length > 0 ? formatParticipantsSummary(value) : placeholder;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            className={cn(
              "h-8 w-full justify-between gap-2 overflow-hidden px-2 text-xs font-normal",
              buttonClassName
            )}
            onClick={(event) => event.stopPropagation()}
          />
        }
      >
        <span className="truncate text-left">
          {triggerLabel}
        </span>
        <div className="flex items-center gap-1">
          {value.length > 0 && (
            <Badge
              variant="outline"
              className="h-5 rounded-full border-emerald-200 bg-emerald-50 px-1.5 text-[10px] text-emerald-700"
            >
              {value.length}
            </Badge>
          )}
          <ChevronDown className="size-3.5 shrink-0 text-slate-400" />
        </div>
      </PopoverTrigger>

      <PopoverContent
        align="start"
        className="w-72 p-0"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="border-b border-slate-100 p-2">
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Поиск участника..."
            className="h-8 text-xs"
          />
        </div>

        <div className="max-h-64 overflow-y-auto p-2">
          {filteredOptions.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 px-3 py-6 text-center text-xs text-slate-500">
              <Users className="size-4 text-slate-300" />
              <span>В каталоге Kaiten пока нет участников.</span>
            </div>
          ) : (
            filteredOptions.map((participant) => {
              const key = participantKey(participant);
              const checked = selectedKeys.has(key);
              return (
                <button
                  key={key}
                  type="button"
                  className={cn(
                    "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-slate-50",
                    checked && "bg-emerald-50"
                  )}
                  onClick={(event) => {
                    event.stopPropagation();
                    toggleParticipant(participant);
                  }}
                >
                  <Checkbox checked={checked} />
                  <span className="flex-1 truncate">{participant.name}</span>
                  {checked && <Check className="size-3.5 text-emerald-600" />}
                </button>
              );
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

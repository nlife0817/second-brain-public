"use client";

import { useState } from "react";
import { Check, UserPlus } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Avatar } from "./bits";
import { assigneeChoice } from "@/lib/core/assignable";
import { useV2Store } from "@/lib/core/ui-store";
import type { UserBrief } from "@/lib/core/types";
import { cn } from "@/lib/utils";

/** Мультивыбор участников организации (для исполнителей и т.п.). */
export function MemberPicker({
  selected,
  onChange,
  trigger,
  projectIds,
}: {
  selected: UserBrief[];
  onChange: (ids: string[]) => void;
  trigger?: React.ReactNode;
  /**
   * Проекты задачи. Закрытый проект пускает в исполнители только своих
   * участников — без этого списка выбор ничем не ограничен.
   */
  projectIds?: string[];
}) {
  const { members, projects } = useV2Store();
  const [open, setOpen] = useState(false);
  const selectedIds = new Set(selected.map((u) => u.id));
  const choice = assigneeChoice(members, projects, projectIds ?? [], selectedIds);

  function toggle(id: string) {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange([...next]);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <button className="inline-flex items-center gap-1 rounded-lg border border-dashed border-border px-2 py-1 text-xs text-muted-foreground hover:border-ring hover:text-foreground">
            {trigger ?? (
              <>
                <UserPlus className="size-3.5" />
                Назначить
              </>
            )}
          </button>
        }
      />
      <PopoverContent className="w-64 p-1" align="start">
        <div className="max-h-64 overflow-y-auto">
          {choice.members.map((m) => (
            <button
              key={m.user_id}
              onClick={() => toggle(m.user_id)}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted"
            >
              <Avatar user={{ id: m.user_id, email: m.email, name: m.name, avatar_url: m.avatar_url }} size="sm" />
              <span className="min-w-0 flex-1">
                <span className="block truncate">{m.name || m.email}</span>
                {m.name && <span className="block truncate text-[11px] text-muted-foreground">{m.email}</span>}
              </span>
              <Check className={cn("size-4", selectedIds.has(m.user_id) ? "opacity-100" : "opacity-0")} />
            </button>
          ))}
          {choice.members.length === 0 && (
            <p className="px-2 py-3 text-center text-xs text-muted-foreground">Нет участников</p>
          )}
        </div>
        {/* Короткий список без объяснения выглядит как потерянные участники. */}
        {choice.restrictedBy.length > 0 && (
          <p className="border-t border-border px-2 py-1.5 text-[11px] leading-4 text-muted-foreground">
            Только участники закрытого проекта «{choice.restrictedBy.join("», «")}»
          </p>
        )}
      </PopoverContent>
    </Popover>
  );
}

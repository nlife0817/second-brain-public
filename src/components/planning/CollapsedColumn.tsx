"use client";

import { ChevronsRight } from "lucide-react";

// Concept §20.2.1: «Колонку можно свернуть в полоску 44px».
// Узкая вертикальная полоса с повёрнутым заголовком и счётчиком.
interface Props {
  title: string;
  count: number;
  onExpand: () => void;
}

export function CollapsedColumn({ title, count, onExpand }: Props) {
  return (
    <button
      type="button"
      onClick={onExpand}
      title={`Развернуть «${title}»`}
      className="group flex h-full w-[44px] shrink-0 flex-col items-center justify-between border-r border-slate-200 bg-slate-50 py-2 hover:bg-slate-100"
    >
      <ChevronsRight className="size-4 text-slate-400 group-hover:text-slate-700" />
      <div className="flex flex-1 items-center justify-center">
        <span
          className="text-xs font-semibold uppercase tracking-wide text-slate-500 group-hover:text-slate-700"
          style={{ writingMode: "vertical-rl", transform: "rotate(180deg)" }}
        >
          {title}
        </span>
      </div>
      <span className="rounded-md bg-slate-200 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-slate-600">
        {count}
      </span>
    </button>
  );
}

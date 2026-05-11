"use client";

import { useState } from "react";
import type { ReplanReason, ReplanReasonCode, PlanningReplanReasonDict } from "@/types/planning";

interface Props {
  open: boolean;
  onClose: () => void;
  onConfirm: (reason: ReplanReason | null) => void | Promise<void>;
  suggestedCode?: string;
  title?: string;
}

// Static fallback (matches seed in migration 0023). Used if /api dict is not loaded yet.
const FALLBACK_DICT: PlanningReplanReasonDict[] = [
  { code: "customer_signal_changed", title: "Сигнал клиентов изменился", requires_text: false },
  { code: "discovery_invalidated",   title: "Гипотеза опровергнута",     requires_text: false },
  { code: "dependency_shifted",      title: "Внешняя зависимость сдвинулась", requires_text: false },
  { code: "scope_underestimated",    title: "Объём недооценён",          requires_text: false },
  { code: "scope_overestimated",     title: "Объём переоценён",          requires_text: false },
  { code: "priority_changed",        title: "Приоритет изменился",       requires_text: true  },
  { code: "external_event",          title: "Внешнее событие",           requires_text: false },
  { code: "kill_criteria_triggered", title: "Сработал kill criteria",    requires_text: false },
  { code: "minor_adjustment",        title: "Минорная правка",           requires_text: false },
];

export function ReplanReasonDialog({ open, onClose, onConfirm, suggestedCode, title = "Причина переплана" }: Props) {
  // Use `open` as a remount key so internal state is reset on each open without an effect.
  if (!open) return null;
  return (
    <ReplanReasonDialogInner
      key={String(suggestedCode ?? "")}
      onClose={onClose}
      onConfirm={onConfirm}
      suggestedCode={suggestedCode}
      title={title}
    />
  );
}

function ReplanReasonDialogInner({ onClose, onConfirm, suggestedCode, title }: Omit<Props, "open">) {
  const [code, setCode] = useState<string>(suggestedCode ?? "");
  const [text, setText] = useState<string>("");

  const selected = FALLBACK_DICT.find((r) => r.code === code);
  const requiresText = selected?.requires_text ?? false;
  const canConfirm = !code || !requiresText || text.trim().length > 0;

  const submit = async () => {
    if (!canConfirm) return;
    const reason: ReplanReason | null = code
      ? { code: code as ReplanReasonCode, ...(text.trim() ? { text: text.trim() } : {}) }
      : null;
    await onConfirm(reason);
  };

  const skip = async () => {
    await onConfirm(null);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-2xl">
        <h3 className="mb-1 text-lg font-semibold">{title}</h3>
        <p className="mb-4 text-xs text-slate-500">
          {suggestedCode
            ? "Система угадала причину по изменению. Подправьте, если нужно."
            : "Выберите причину или пропустите шаг."}
        </p>

        <label className="mb-3 block text-sm">
          <span className="mb-1 block text-xs font-medium text-slate-600">Категория</span>
          <select
            value={code}
            onChange={(e) => setCode(e.target.value)}
            className="w-full rounded-md border border-slate-300 px-2 py-1.5"
          >
            <option value="">— не указана —</option>
            {FALLBACK_DICT.map((r) => (
              <option key={r.code} value={r.code}>
                {r.title}{r.code === suggestedCode ? "  (предложено)" : ""}
              </option>
            ))}
          </select>
        </label>

        <label className="mb-4 block text-sm">
          <span className="mb-1 block text-xs font-medium text-slate-600">
            Комментарий {requiresText ? "*" : ""}
          </span>
          <textarea
            rows={3}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Опционально"
            className="w-full resize-y rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
          />
          {requiresText && !text.trim() && (
            <span className="mt-1 block text-[11px] text-red-600">Для этой категории комментарий обязателен.</span>
          )}
        </label>

        <div className="flex items-center justify-between gap-2">
          <button type="button" onClick={onClose} className="rounded-md px-3 py-1.5 text-sm text-slate-500 hover:bg-slate-100">Отмена</button>
          <div className="flex gap-2">
            <button type="button" onClick={skip} className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50">Пропустить</button>
            <button
              type="button"
              onClick={submit}
              disabled={!canConfirm}
              className="rounded-md bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
            >
              Сохранить
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

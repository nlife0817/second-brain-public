"use client";

// Empty state with call-to-action button(s). Concept §20.1.4.

interface Action {
  label: string;
  onClick: () => void;
  variant?: "primary" | "secondary";
}

interface Props {
  title: string;
  description?: string;
  actions?: Action[];
}

export function EmptyState({ title, description, actions }: Props) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-6 py-10 text-center">
      <p className="text-sm font-medium text-slate-700">{title}</p>
      {description && <p className="max-w-md text-xs text-slate-500">{description}</p>}
      {actions && actions.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
          {actions.map((a, i) => (
            <button
              key={i}
              onClick={a.onClick}
              className={
                a.variant === "secondary"
                  ? "rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50"
                  : "rounded-md bg-blue-600 px-3 py-1.5 text-xs text-white hover:bg-blue-700"
              }
            >
              {a.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

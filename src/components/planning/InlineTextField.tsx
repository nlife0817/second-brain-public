"use client";

import { useState, useRef, useEffect, type KeyboardEvent } from "react";

interface Props {
  value: string;
  onSave: (next: string) => void | Promise<void>;
  placeholder?: string;
  className?: string;
  multiline?: boolean;
}

export function InlineTextField({ value, onSave, placeholder, className, multiline }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);

  useEffect(() => { setDraft(value); }, [value]);
  useEffect(() => { if (editing && inputRef.current) inputRef.current.focus(); }, [editing]);

  const commit = async () => {
    setEditing(false);
    if (draft !== value) await onSave(draft);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !multiline) { e.preventDefault(); commit(); }
    if (e.key === "Escape") { setDraft(value); setEditing(false); }
  };

  if (editing) {
    const sharedProps = {
      ref: inputRef as React.RefObject<HTMLInputElement & HTMLTextAreaElement>,
      value: draft,
      onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setDraft(e.target.value),
      onBlur: commit,
      onKeyDown,
      placeholder,
      className: `w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-sm focus:border-blue-500 focus:outline-none ${className ?? ""}`,
    };
    return multiline ? <textarea rows={3} {...sharedProps} /> : <input type="text" {...sharedProps} />;
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      className={`w-full cursor-text rounded-md px-2 py-1 text-left text-sm hover:bg-slate-50 ${className ?? ""}`}
    >
      {value || <span className="text-slate-400">{placeholder ?? "..."}</span>}
    </button>
  );
}

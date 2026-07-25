"use client";

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

export interface InlineSelectOption<T extends string> {
  key: T;
  label: string;
  node?: React.ReactNode;
}

export function InlineSelectPopover<T extends string>({
  value,
  options,
  onCommit,
  onCancel,
  anchorRef,
  className,
}: {
  value: T;
  options: InlineSelectOption<T>[];
  onCommit: (val: T) => void;
  onCancel: () => void;
  anchorRef?: React.RefObject<HTMLElement | null>;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const hasEnteredRef = useRef(false);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useLayoutEffect(() => {
    const anchor = anchorRef?.current;
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPos({
      top: spaceBelow < 200 ? rect.top - 8 : rect.bottom + 4,
      left: rect.left,
    });
  }, [anchorRef]);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onCancel();
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onCancel]);

  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      }
    }
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onCancel]);

  useEffect(() => {
    return () => {
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    };
  }, []);

  const handleMouseEnter = useCallback(() => {
    hasEnteredRef.current = true;
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  const handleMouseLeave = useCallback(() => {
    if (!hasEnteredRef.current) return;
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    closeTimerRef.current = setTimeout(() => {
      closeTimerRef.current = null;
      onCancel();
    }, 200);
  }, [onCancel]);

  if (!pos) return null;

  const openUp = pos.top > window.innerHeight / 2;

  return createPortal(
    <div
      ref={ref}
      style={{
        position: "fixed",
        top: openUp ? undefined : pos.top,
        bottom: openUp ? window.innerHeight - pos.top + 4 : undefined,
        left: pos.left,
        zIndex: 9999,
      }}
      className={cn(
        "min-w-[140px] max-h-[220px] overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg",
        className
      )}
      onClick={(e) => e.stopPropagation()}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {options.map((opt) => (
        <button
          key={opt.key}
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onCommit(opt.key);
          }}
          className={cn(
            "flex w-full items-center px-3 py-1.5 text-left text-[11px] hover:bg-slate-50",
            opt.key === value && "bg-violet-50 font-medium text-violet-700"
          )}
        >
          {opt.node ?? opt.label}
        </button>
      ))}
    </div>,
    document.body
  );
}

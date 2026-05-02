"use client";

import { useEffect, useState } from "react";
import { Square, Loader2 } from "lucide-react";
import { useTimingStore, formatHMS } from "@/lib/timing-store";

/**
 * Compact timer widget rendered inside the Document Picture-in-Picture window.
 * Reads the same useTimingStore as the main app — actions stay synchronised.
 */
export function PipTimerWidget() {
  const activeEntry = useTimingStore((s) => s.activeEntry);
  const itemTitle = useTimingStore((s) => s.itemTitle);
  const stop = useTimingStore((s) => s.stop);
  const [stopping, setStopping] = useState(false);
  const [, setTick] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), 1000);
    return () => window.clearInterval(id);
  }, []);

  const elapsed = useTimingStore.getState().elapsedSeconds();

  const handleStop = async () => {
    if (stopping) return;
    setStopping(true);
    try {
      await stop();
    } catch (e) {
      console.error("[timing pip] stop failed", e);
    } finally {
      setStopping(false);
    }
  };

  if (!activeEntry) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: "100%",
          color: "rgb(120, 120, 130)",
          fontSize: 13,
          padding: 12,
          textAlign: "center",
        }}
      >
        Активного таймера нет — закройте это окно
      </div>
    );
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "stretch",
        height: "100%",
        padding: 10,
        gap: 8,
        boxSizing: "border-box",
      }}
    >
      <div
        title={itemTitle ?? undefined}
        style={{
          fontSize: 11,
          opacity: 0.75,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {itemTitle ?? "Задача"}
      </div>
      <div
        style={{
          fontFamily:
            'ui-monospace, "SF Mono", Menlo, Monaco, "Cascadia Mono", "Roboto Mono", monospace',
          fontSize: 32,
          fontVariantNumeric: "tabular-nums",
          fontWeight: 600,
          letterSpacing: "0.02em",
        }}
      >
        {formatHMS(elapsed)}
      </div>
      <button
        type="button"
        onClick={handleStop}
        disabled={stopping}
        style={{
          marginTop: "auto",
          height: 32,
          border: "none",
          borderRadius: 8,
          background: "rgba(220, 38, 38, 0.12)",
          color: "rgb(220, 38, 38)",
          cursor: stopping ? "wait" : "pointer",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 6,
          fontSize: 13,
          fontWeight: 500,
          opacity: stopping ? 0.7 : 1,
        }}
      >
        {stopping ? <Loader2 size={14} /> : <Square size={14} />}
        Остановить
      </button>
    </div>
  );
}

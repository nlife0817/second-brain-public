"use client";

import { useEffect, useState } from "react";
import { Square, Loader2 } from "lucide-react";
import { useTimingStore, formatHMS } from "@/lib/timing-store";

/**
 * Compact one-line timer rendered inside the Document Picture-in-Picture window.
 * Layout: [● HH:MM:SS · task title] [⏹]
 *
 * Designed for a 220×56 PiP window — minimal vertical footprint.
 */
export function PipTimerWidget() {
  const hasActive = useTimingStore((s) => s.activeEntry !== null);
  const itemTitle = useTimingStore((s) => s.itemTitle);
  const stop = useTimingStore((s) => s.stop);
  const [stopping, setStopping] = useState(false);
  const [, setTick] = useState(0);

  useEffect(() => {
    if (!hasActive) return;
    const id = window.setInterval(() => setTick((t) => t + 1), 1000);
    return () => window.clearInterval(id);
  }, [hasActive]);

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

  if (!hasActive) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: "100%",
          color: "rgb(120, 120, 130)",
          fontSize: 11,
          padding: 6,
          textAlign: "center",
        }}
      >
        Таймер не запущен
      </div>
    );
  }

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        height: "100%",
        padding: "0 8px",
        gap: 6,
        boxSizing: "border-box",
      }}
    >
      {/* Pulsing dot */}
      <span
        aria-hidden
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: "rgb(16, 185, 129)",
          flexShrink: 0,
          animation: "sb-pulse 1.6s ease-in-out infinite",
        }}
      />
      {/* Time */}
      <span
        style={{
          fontFamily:
            'ui-monospace, "SF Mono", Menlo, Monaco, "Cascadia Mono", "Roboto Mono", monospace',
          fontSize: 14,
          fontVariantNumeric: "tabular-nums",
          fontWeight: 600,
          flexShrink: 0,
        }}
      >
        {formatHMS(elapsed)}
      </span>
      {/* Title */}
      <span
        title={itemTitle ?? undefined}
        style={{
          flex: 1,
          minWidth: 0,
          fontSize: 11,
          opacity: 0.7,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {itemTitle ?? ""}
      </span>
      {/* Stop button (icon only) */}
      <button
        type="button"
        onClick={handleStop}
        disabled={stopping}
        title="Остановить"
        aria-label="Остановить"
        style={{
          width: 24,
          height: 24,
          border: "none",
          borderRadius: 6,
          background: "rgba(220, 38, 38, 0.12)",
          color: "rgb(220, 38, 38)",
          cursor: stopping ? "wait" : "pointer",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
          opacity: stopping ? 0.7 : 1,
        }}
      >
        {stopping ? <Loader2 size={12} /> : <Square size={12} />}
      </button>
      <style>{`@keyframes sb-pulse {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.35; }
      }`}</style>
    </div>
  );
}

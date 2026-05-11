// Auto-distribute target curves for planning metrics.
// See planning_system_concept.md §6.7.1.

import type { DistributeCurve } from "@/types/planning";

/**
 * Distribute a year-level target across N child periods (quarters/months/weeks)
 * using one of the supported curves.
 *
 * For curve='history', pass `historyShares` — proportions from the previous
 * year (length must equal `count`); they will be re-scaled to sum to yearTarget.
 *
 * The output array has the same length as `count` and its sum is normalised so
 * |sum - yearTarget| <= 1 (we rely on floats; consumer rounds for display).
 */
export function distributeTarget(curve: DistributeCurve, yearTarget: number, count: number, historyShares?: number[]): number[] {
  if (count <= 0) return [];
  if (count === 1) return [yearTarget];

  switch (curve) {
    case "linear":
      return normalise(new Array(count).fill(yearTarget / count), yearTarget);

    case "s_curve": {
      // Sigmoid centred at the midpoint, k=4, then normalised.
      const k = 4;
      const mid = (count - 1) / 2;
      const raw = Array.from({ length: count }, (_, i) =>
        1 / (1 + Math.exp(-k * ((i - mid) / mid)))
      );
      return normalise(raw, yearTarget);
    }

    case "front_loaded":
      return tripleSplit(count, yearTarget, [0.4, 0.35, 0.25]);

    case "back_loaded":
      return tripleSplit(count, yearTarget, [0.2, 0.3, 0.5]);

    case "history": {
      // Replay last year's proportions onto the new yearTarget.
      // If history is absent or length mismatch, fall back to linear.
      if (!historyShares || historyShares.length !== count) {
        return normalise(new Array(count).fill(yearTarget / count), yearTarget);
      }
      const sum = historyShares.reduce((a, b) => a + b, 0);
      if (sum === 0) return normalise(new Array(count).fill(yearTarget / count), yearTarget);
      return normalise(historyShares.slice(), yearTarget);
    }

    case "custom":
      return new Array(count).fill(0);
  }
}

function normalise(values: number[], total: number): number[] {
  const sum = values.reduce((a, b) => a + b, 0);
  if (sum === 0) return values;
  const factor = total / sum;
  return values.map((v) => v * factor);
}

/** Split `count` slots into three thirds with the given shares; preserves count exactly. */
function tripleSplit(count: number, total: number, shares: [number, number, number]): number[] {
  const sliceSize = Math.ceil(count / 3);
  const slices = [
    Math.min(sliceSize, count),
    Math.min(sliceSize, Math.max(0, count - sliceSize)),
    Math.max(0, count - 2 * sliceSize),
  ];
  const out: number[] = [];
  for (let s = 0; s < 3; s++) {
    const n = slices[s];
    if (n === 0) continue;
    const portion = (total * shares[s]) / n;
    for (let i = 0; i < n; i++) out.push(portion);
  }
  return out;
}

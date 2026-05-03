import type { GoalAxisConfig } from "@/types";
import { FALLBACK_AXIS_CONFIG } from "@/types";

/**
 * Look up axis config by id; returns null when axis is not set, fallback object
 * when axis was deleted. Use as: `const ax = lookupAxis(axes, goal.axis)`.
 */
export function lookupAxis(
  axes: GoalAxisConfig[],
  axisId: string | null | undefined,
): GoalAxisConfig | null {
  if (!axisId) return null;
  const found = axes.find((a) => a.id === axisId);
  if (found) return found;
  // Axis was deleted but goal still references it — render with fallback colors but keep id as label.
  return {
    id: axisId,
    name: axisId,
    color: FALLBACK_AXIS_CONFIG.color,
    bg: FALLBACK_AXIS_CONFIG.bg,
    icon: FALLBACK_AXIS_CONFIG.icon,
    position: 0,
    is_system: 0,
    created_at: "",
    updated_at: "",
  };
}

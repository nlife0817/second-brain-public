"use client";

import { memo } from "react";
import { LineChart, Line, ResponsiveContainer } from "recharts";

interface Props {
  data: Array<{ x: string | number; y: number }>;
  color?: string;
  height?: number;
}

// Mini chart for Digest tiles. Concept §20.2.5.
function SparklineBase({ data, color = "#2563eb", height = 32 }: Props) {
  if (!data || data.length === 0) {
    return <div className="h-8 w-full rounded bg-slate-100" />;
  }
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data}>
          <Line
            type="monotone"
            dataKey="y"
            stroke={color}
            strokeWidth={1.5}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export const Sparkline = memo(SparklineBase);

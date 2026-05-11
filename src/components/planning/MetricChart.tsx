"use client";

import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from "recharts";

interface Point { date: string; plan?: number; fact?: number; virtual?: number; }

interface Props { data: Point[]; }

export function MetricChart({ data }: Props) {
  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data}>
          <CartesianGrid stroke="#f1f5f9" />
          <XAxis dataKey="date" tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} />
          <Tooltip />
          <Legend />
          <Line type="monotone" dataKey="plan" name="План" stroke="#94a3b8" strokeDasharray="3 3" dot={false} />
          <Line type="monotone" dataKey="fact" name="Факт" stroke="#2563eb" strokeWidth={2} dot={{ r: 3 }} />
          <Line type="monotone" dataKey="virtual" name="Прогноз" stroke="#16a34a" strokeDasharray="2 2" dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

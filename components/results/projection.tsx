'use client';

import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { MonthlyPoint } from '@/lib/engine/types';
import { compact } from '@/lib/ui';

export default function Projection({ months }: { months: MonthlyPoint[] }) {
  const data = months.map((m) => ({
    label: m.label,
    low: m.conservativeCredits,
    band: Math.max(m.aggressiveCredits - m.conservativeCredits, 0),
    expected: m.expectedCredits,
  }));

  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 4 }}>
          <defs>
            <linearGradient id="bandFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--color-accent)" stopOpacity={0.28} />
              <stop offset="100%" stopColor="var(--color-accent)" stopOpacity={0.06} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="var(--color-line)" strokeDasharray="2 4" vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 10, fill: 'var(--color-fg-subtle)' }}
            tickLine={false}
            axisLine={{ stroke: 'var(--color-line)' }}
            interval="preserveStartEnd"
            minTickGap={12}
          />
          <YAxis
            tickFormatter={(v: number) => compact(v)}
            tick={{ fontSize: 10, fill: 'var(--color-fg-subtle)' }}
            tickLine={false}
            axisLine={false}
            width={46}
          />
          <Tooltip
            cursor={{ stroke: 'var(--color-line-strong)' }}
            contentStyle={{
              background: 'var(--color-bg-raised)',
              border: '1px solid var(--color-line-strong)',
              borderRadius: 10,
              fontSize: 12,
              color: 'var(--color-fg)',
            }}
            formatter={(v, name) => [
              compact(Number(v)),
              name === 'low' ? 'Conservative' : name === 'band' ? 'Band width' : 'Expected',
            ]}
          />
          <Area
            type="monotone"
            dataKey="low"
            stackId="band"
            stroke="none"
            fill="transparent"
            isAnimationActive={false}
          />
          <Area
            type="monotone"
            dataKey="band"
            stackId="band"
            stroke="none"
            fill="url(#bandFill)"
            isAnimationActive={false}
          />
          <Line
            type="monotone"
            dataKey="expected"
            stroke="var(--color-accent)"
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

import { useMemo } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { HistoryPoint, RangeKey } from '../lib/types';
import { fmtClock, fmtCompactW, fmtDateTime, fmtInt } from '../lib/format';

interface PowerAreaChartProps {
  points: HistoryPoint[];
  range: RangeKey;
  height?: number;
}

interface TipPayloadRow {
  payload?: HistoryPoint;
}

/** Dark rounded tooltip with dot-leader rows (image 9) — dark in BOTH themes. */
function ChartTip({ active, payload }: { active?: boolean; payload?: TipPayloadRow[] }) {
  const point = active && payload && payload.length > 0 ? payload[0].payload : undefined;
  if (!point) return null;
  const rows: Array<{ label: string; value: string; swatch?: string }> = [
    { label: 'Power', value: `${fmtInt(point.avgPowerW)} W` },
    { label: 'L1', value: `${fmtInt(point.phases.L1)} W`, swatch: 'var(--chart-l1)' },
    { label: 'L2', value: `${fmtInt(point.phases.L2)} W`, swatch: 'var(--chart-l2)' },
    { label: 'L3', value: `${fmtInt(point.phases.L3)} W`, swatch: 'var(--chart-l3)' },
  ];
  return (
    <div className="tip">
      <div className="tip-title">{fmtDateTime(point.ts)}</div>
      {rows.map((r) => (
        <div className="tip-row" key={r.label}>
          {r.swatch && <span className="tip-swatch" style={{ background: r.swatch }} />}
          <span style={{ color: r.swatch ? 'var(--tooltip-ink-2)' : undefined }}>{r.label}</span>
          <span className="tip-leader" />
          <span className="tip-num">{r.value}</span>
        </div>
      ))}
    </div>
  );
}

export function PowerAreaChart({ points, range, height = 260 }: PowerAreaChartProps) {
  const ticks = useMemo(() => {
    if (points.length < 2) return [];
    const first = points[0].ts;
    const last = points[points.length - 1].ts;
    const count = 5;
    return Array.from({ length: count }, (_, i) => first + ((last - first) * i) / (count - 1));
  }, [points]);

  const tickFormat = (ts: number) =>
    range === '7d'
      ? new Date(ts).toLocaleDateString('en-GB', { weekday: 'short' })
      : fmtClock(ts);

  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={points} margin={{ top: 8, right: 18, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="powerFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--chart-line)" stopOpacity={0.22} />
              <stop offset="100%" stopColor="var(--chart-line)" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
          <XAxis
            dataKey="ts"
            type="number"
            domain={['dataMin', 'dataMax']}
            ticks={ticks}
            tickFormatter={tickFormat}
            tickMargin={10}
            minTickGap={30}
          />
          <YAxis
            dataKey="avgPowerW"
            tickFormatter={(v: number) => fmtCompactW(v)}
            width={44}
            tickMargin={6}
            domain={[0, 'auto']}
          />
          <Tooltip
            content={<ChartTip />}
            cursor={{ stroke: 'var(--hairline-strong)', strokeDasharray: '3 4' }}
            isAnimationActive={false}
          />
          <Area
            type="monotone"
            dataKey="avgPowerW"
            stroke="var(--chart-line)"
            strokeWidth={2}
            fill="url(#powerFill)"
            isAnimationActive={false}
            activeDot={{
              r: 4.5,
              fill: 'var(--chart-line)',
              stroke: 'var(--surface)',
              strokeWidth: 2,
            }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function RangeSelector({
  value,
  onChange,
  options = ['1h', '24h', '7d'] as RangeKey[],
}: {
  value: RangeKey;
  onChange: (r: RangeKey) => void;
  options?: RangeKey[];
}) {
  return (
    <div className="seg" role="tablist" aria-label="History range">
      {options.map((r) => (
        <button
          key={r}
          role="tab"
          aria-selected={value === r}
          className={`seg-btn${value === r ? ' is-active' : ''}`}
          onClick={() => onChange(r)}
        >
          {r.toUpperCase()}
        </button>
      ))}
    </div>
  );
}

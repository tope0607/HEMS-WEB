import { fmtKwh } from '../lib/format';

interface DonutProps {
  /** slices in fixed phase order L1, L2, L3 */
  values: [number, number, number];
  totalLabel: string;
  totalValue: number;
}

const COLORS = ['var(--chart-l1)', 'var(--chart-l2)', 'var(--chart-l3)'];
const LABELS = ['L1', 'L2', 'L3'];
const R = 56;
const STROKE = 12; // thin-stroke donut (images 2, 9)
const C = 2 * Math.PI * R;
const GAP = 5; // px gap between slices on the circumference

/** Thin-stroke donut with centre total. */
export function Donut({ values, totalLabel, totalValue }: DonutProps) {
  const total = values.reduce((a, b) => a + b, 0);
  let offset = C * 0.25; // start at 12 o'clock

  return (
    <div className="donut-wrap">
      <svg width={148} height={148} viewBox="0 0 148 148" role="img" aria-label={`${totalLabel}: ${LABELS.map((l, i) => `${l} ${fmtKwh(values[i])}`).join(', ')} kWh`}>
        {total > 0 &&
          values.map((v, i) => {
            const len = Math.max(0, (v / total) * C - GAP);
            const el = (
              <circle
                key={i}
                cx={74}
                cy={74}
                r={R}
                fill="none"
                stroke={COLORS[i]}
                strokeWidth={STROKE}
                strokeLinecap="round"
                strokeDasharray={`${len} ${C - len}`}
                strokeDashoffset={offset}
              />
            );
            offset -= (v / total) * C;
            return el;
          })}
        <text x={74} y={69} className="donut-center-label" style={{ fill: 'var(--ink)', fontSize: 22 }}>
          {fmtKwh(totalValue)}
        </text>
        <text
          x={74}
          y={88}
          textAnchor="middle"
          style={{ fill: 'var(--ink-3)', fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.1em' }}
        >
          {totalLabel}
        </text>
      </svg>
      <div className="donut-rows">
        {values.map((v, i) => (
          <div className="phase-row" key={i} style={i === 0 ? { borderTop: 'none' } : undefined}>
            <span className="phase-swatch" style={{ background: COLORS[i] }} />
            <span className="phase-tag">{LABELS[i]}</span>
            <span className="leader" />
            <span className="mono-value" style={{ color: 'var(--ink)' }}>
              {fmtKwh(v)} kWh
            </span>
            <span className="mono-value" style={{ color: 'var(--ink-3)', width: 38, textAlign: 'right' }}>
              {total > 0 ? Math.round((v / total) * 100) : 0}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

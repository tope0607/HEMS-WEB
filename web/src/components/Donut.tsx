import { fmtKwh } from '../lib/format';

interface DonutProps {
  /** slices in fixed phase order L1, L2, L3 */
  values: [number, number, number];
  totalLabel: string;
  totalValue: number;
}

const COLORS = ['var(--chart-l1)', 'var(--chart-l2)', 'var(--chart-l3)'];
const LABELS = ['L1', 'L2', 'L3'];

const SIZE = 210;
const CX = SIZE / 2;
const R = 66; // segment ring
const STROKE = 21; // thick, vivid ring (design_taste_2 fig 1)
const TICK_R = 89; // outer decorative tick ring
const C = 2 * Math.PI * R;
const GAP = 10; // px gap between segments on the circumference

/** Thick rounded-segment donut with an outer tick ring and centre total. */
export function Donut({ values, totalLabel, totalValue }: DonutProps) {
  const total = values.reduce((a, b) => a + b, 0);
  let offset = C * 0.25; // start at 12 o'clock

  return (
    <div className="donut-wrap">
      <svg
        width={SIZE}
        height={SIZE}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        role="img"
        aria-label={`${totalLabel}: ${LABELS.map((l, i) => `${l} ${fmtKwh(values[i])}`).join(', ')} kWh`}
      >
        {/* outer tick ring — instrument-panel detail */}
        <circle
          cx={CX}
          cy={CX}
          r={TICK_R}
          fill="none"
          stroke="var(--hairline-strong)"
          strokeWidth={7}
          strokeDasharray="1.6 6.2"
        />
        {/* track so tiny slices still read as part of a whole */}
        <circle cx={CX} cy={CX} r={R} fill="none" stroke="var(--surface-2)" strokeWidth={STROKE} />
        {total > 0 &&
          values.map((v, i) => {
            const len = Math.max(0, (v / total) * C - GAP);
            const el =
              len > 0.5 ? (
                <circle
                  key={i}
                  cx={CX}
                  cy={CX}
                  r={R}
                  fill="none"
                  stroke={COLORS[i]}
                  strokeWidth={STROKE}
                  strokeLinecap="round"
                  strokeDasharray={`${len} ${C - len}`}
                  strokeDashoffset={offset - GAP / 2}
                />
              ) : null;
            offset -= (v / total) * C;
            return el;
          })}
        <text
          x={CX}
          y={CX - 4}
          className="donut-center-label"
          dominantBaseline="middle"
          style={{ fill: 'var(--ink)', fontSize: 27 }}
        >
          {fmtKwh(totalValue)}
        </text>
        <text
          x={CX}
          y={CX + 19}
          textAnchor="middle"
          dominantBaseline="middle"
          style={{
            fill: 'var(--ink-3)',
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            letterSpacing: '0.12em',
          }}
        >
          {totalLabel}
        </text>
      </svg>

      <div className="donut-rows">
        {values.map((v, i) => (
          <div className="donut-row" key={i}>
            <span className="donut-tick" style={{ background: COLORS[i] }} />
            <span className="phase-tag" style={{ width: 'auto' }}>{LABELS[i]}</span>
            <span className="leader" />
            <span className="mono-value" style={{ color: 'var(--ink)' }}>
              {fmtKwh(v)} kWh
            </span>
            <span className="mono-value phase-pct" style={{ color: 'var(--ink-3)' }}>
              {total > 0 ? Math.round((v / total) * 100) : 0}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

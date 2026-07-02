import { useId, useMemo } from 'react';
import { fmtCompactW, fmtInt } from '../lib/format';

interface LoadGaugeProps {
  watts: number;
  capacityW: number;
}

const TICKS = 37; // instrument-panel tick count across the 180° sweep
const R = 84;
const CX = 110;
const CY = 102;

/** Semicircular tick gauge (image 2): ticks light up to the load fraction;
 *  colour communicates zone (green → amber ≥60 % → red ≥85 %). */
export function LoadGauge({ watts, capacityW }: LoadGaugeProps) {
  const frac = Math.min(1, Math.max(0, watts / capacityW));
  const titleId = useId();

  const ticks = useMemo(() => {
    return Array.from({ length: TICKS }, (_, i) => {
      const t = i / (TICKS - 1);
      const angle = Math.PI * (1 - t); // 180° → 0°
      const inner = R - 14;
      const outer = R;
      const x1 = CX + inner * Math.cos(angle);
      const y1 = CY - inner * Math.sin(angle);
      const x2 = CX + outer * Math.cos(angle);
      const y2 = CY - outer * Math.sin(angle);
      return { t, x1, y1, x2, y2 };
    });
  }, []);

  const zoneColor = frac >= 0.85 ? 'var(--red)' : frac >= 0.6 ? 'var(--amber)' : 'var(--green)';

  return (
    <div className="gauge-wrap">
      <svg
        width={220}
        height={118}
        viewBox="0 0 220 118"
        role="img"
        aria-labelledby={titleId}
      >
        <title id={titleId}>
          Load {Math.round(frac * 100)}% of {fmtInt(capacityW)} watts capacity
        </title>
        {ticks.map(({ t, x1, y1, x2, y2 }, i) => {
          const lit = t <= frac && frac > 0.005;
          return (
            <line
              key={i}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke={lit ? zoneColor : 'var(--hairline-strong)'}
              strokeWidth={t === 0 || t === 1 || i % 6 === 0 ? 3.4 : 2.2}
              strokeLinecap="round"
            />
          );
        })}
      </svg>
      <div className="gauge-center">
        <div className="numeral" style={{ fontSize: 40 }}>
          {Math.round(frac * 100)}
          <span className="unit">%</span>
        </div>
        <div className="mono-value" style={{ marginTop: 2 }}>
          of {fmtCompactW(capacityW)}W
        </div>
      </div>
      <div className="gauge-legend">
        <span className="mono-value">0</span>
        <span className="mono-value" style={{ color: frac >= 0.85 ? 'var(--tint-red-fg)' : undefined }}>
          {fmtInt(watts)} W
        </span>
        <span className="mono-value">{fmtCompactW(capacityW)}</span>
      </div>
    </div>
  );
}

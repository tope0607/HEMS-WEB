import { fmtInt } from '../lib/format';
import type { LiveData } from '../lib/types';

const PHASES = ['L1', 'L2', 'L3'] as const;

const PHASE_VAR: Record<(typeof PHASES)[number], string> = {
  L1: 'var(--chart-l1)',
  L2: 'var(--chart-l2)',
  L3: 'var(--chart-l3)',
};

/** Segmented horizontal phase-split bar + dot-leader rows (image 9).
 *  Identity is carried by tag + swatch + direct value — never colour alone. */
export function PhaseBars({ live }: { live: LiveData }) {
  const total = PHASES.reduce((s, k) => s + live.phases[k].p, 0);

  return (
    <div>
      <div className="phase-total-bar" role="img" aria-label={`Phase split: ${PHASES.map((k) => `${k} ${fmtInt(live.phases[k].p)} watts`).join(', ')}`}>
        {PHASES.map((k) => {
          const share = total > 0 ? live.phases[k].p / total : 1 / 3;
          return (
            <div
              key={k}
              className="seg-fill"
              style={{ width: `${(share * 100).toFixed(2)}%`, background: PHASE_VAR[k] }}
            />
          );
        })}
      </div>
      {PHASES.map((k) => {
        const ph = live.phases[k];
        const share = total > 0 ? Math.round((ph.p / total) * 100) : 0;
        return (
          <div key={k} className="phase-row">
            <span className="phase-swatch" style={{ background: PHASE_VAR[k] }} />
            <span className="phase-tag">{k}</span>
            <span className="mono-value" style={{ color: 'var(--ink-3)' }}>
              {ph.v.toFixed(1)}V · PF {ph.pf.toFixed(2)}
            </span>
            <span className="leader" />
            <span className="phase-meta">
              <span className="mono-value" style={{ color: 'var(--ink-3)' }}>{share}%</span>
              <span className="mono-value" style={{ color: 'var(--ink)' }}>{fmtInt(ph.p)} W</span>
            </span>
          </div>
        );
      })}
    </div>
  );
}

import { AlertIcon } from './Icons';
import { fmtInt } from '../lib/format';
import { CAPACITY_W, HIGH_LOAD_FRACTION } from '../lib/config';

interface HighLoadBannerProps {
  watts: number;
}

/** Designed alert banner: amber when near threshold, red when at/over capacity. */
export function HighLoadBanner({ watts }: HighLoadBannerProps) {
  const critical = watts >= CAPACITY_W * 0.95;
  const threshold = Math.round(CAPACITY_W * HIGH_LOAD_FRACTION);
  return (
    <div className={`banner${critical ? ' banner--red' : ''}`} role="alert">
      <span className="banner-glyph">
        <AlertIcon size={17} />
      </span>
      <div>
        <div className="banner-title">{critical ? 'Overload imminent' : 'High load'}</div>
        <div className="banner-detail mono" style={{ fontSize: 12 }}>
          {fmtInt(watts)} W ≥ {fmtInt(threshold)} W threshold — consider shedding heavy loads
        </div>
      </div>
    </div>
  );
}

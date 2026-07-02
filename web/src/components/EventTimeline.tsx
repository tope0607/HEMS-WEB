import type { EventItem } from '../lib/types';
import { fmtClock, fmtInt, fmtRelative } from '../lib/format';

const dotColor = (e: EventItem) =>
  e.type === 'high_load' ? 'var(--amber)' : e.event === 'ON' ? 'var(--green)' : 'var(--ink-3)';

const describe = (e: EventItem) =>
  e.type === 'high_load'
    ? 'High load'
    : `${e.appliance ?? 'Appliance'}`;

const detail = (e: EventItem) =>
  e.type === 'high_load'
    ? `threshold crossed · ${fmtInt(e.powerW)} W`
    : `switched ${e.event === 'ON' ? 'on' : 'off'} · ${fmtInt(e.powerW)} W total`;

/** Appliance ON/OFF timeline list (image 1). */
export function EventTimeline({ events, now }: { events: EventItem[]; now: number }) {
  if (events.length === 0) {
    return <div className="empty-note mono-value">No events yet</div>;
  }
  return (
    <ul className="timeline">
      {events.map((e) => (
        <li className="tl-item" key={e.id}>
          <span className="tl-dot" style={{ background: dotColor(e) }} />
          <div className="tl-body">
            <div className="tl-main">
              <div className="tl-what">{describe(e)}</div>
              <div className="tl-sub" title={detail(e)}>{detail(e)}</div>
            </div>
            <span className="tl-time mono-value" title={new Date(e.ts).toLocaleString()}>
              {now - e.ts < 60 * 60_000 ? fmtRelative(e.ts, now) : fmtClock(e.ts)}
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}

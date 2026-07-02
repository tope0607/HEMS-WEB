import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { useLive } from '../lib/useLive';
import { getDataSource } from '../lib/dataSource';
import { isDeviceLive, type EventItem, type HistoryPoint, type RangeKey } from '../lib/types';
import { CAPACITY_W, TARIFF_NAIRA_PER_KWH } from '../lib/config';
import { fmtInt, fmtKwh } from '../lib/format';
import { Sparkline } from '../components/Sparkline';
import { LoadGauge } from '../components/LoadGauge';
import { PhaseBars } from '../components/PhaseBars';
import { PowerAreaChart, RangeSelector } from '../components/PowerAreaChart';
import { EventTimeline } from '../components/EventTimeline';
import { HighLoadBanner } from '../components/HighLoadBanner';
import { ContactorCard } from '../components/ContactorCard';
import { Pill } from '../components/Pill';

const SPARK_LEN = 40;

export function HomePage() {
  const { user } = useAuth();
  const { live, control } = useLive();

  /* live sparkline ring buffer */
  const sparkRef = useRef<number[]>([]);
  if (live && sparkRef.current[sparkRef.current.length - 1] !== live.totalPowerW) {
    sparkRef.current = [...sparkRef.current, live.totalPowerW].slice(-SPARK_LEN);
  }

  /* history area chart */
  const [range, setRange] = useState<RangeKey>('24h');
  const [historyPoints, setHistoryPoints] = useState<HistoryPoint[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    setHistoryLoading(true);
    (async () => {
      const src = await getDataSource();
      const points = await src.fetchHistory(range);
      if (!cancelled) {
        setHistoryPoints(points);
        setHistoryLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [range]);

  /* events timeline (live, low volume) */
  const [events, setEvents] = useState<EventItem[]>([]);
  useEffect(() => {
    let unsub: (() => void) | undefined;
    (async () => {
      const src = await getDataSource();
      unsub = src.subscribeEvents(8, setEvents);
    })();
    return () => unsub?.();
  }, []);

  const requestContactor = useMemo(
    () => async (state: 0 | 1) => {
      const src = await getDataSource();
      if (!user) throw new Error('not signed in');
      await src.requestContactor(state, user.uid);
    },
    [user]
  );

  if (!live) {
    return (
      <div className="card" style={{ textAlign: 'center', padding: 48 }}>
        <span className="spinner" style={{ margin: '0 auto 12px' }} />
        <div className="mono-value">Connecting to /live…</div>
      </div>
    );
  }

  const avgPf =
    (live.phases.L1.pf + live.phases.L2.pf + live.phases.L3.pf) / 3;
  const totalAmps = live.phases.L1.i + live.phases.L2.i + live.phases.L3.i;

  return (
    <div className="grid-home">
      {live.highLoad && <HighLoadBanner watts={live.totalPowerW} />}

      {/* 1 — live power hero */}
      <section className="card col-7" aria-label="Live power">
        <div className="card-head">
          <span className="mono-label">
            Live power
            {isDeviceLive(live) && (
              <span
                className="pill-dot pill-dot--pulse"
                style={{ background: 'var(--magenta)', width: 6, height: 6 }}
              />
            )}
          </span>
          <Pill tone={live.contactorState === 1 ? 'green' : 'red'}>
            {live.contactorState === 1 ? 'CONTACTOR ON' : 'CONTACTOR OPEN'}
          </Pill>
        </div>
        <div className="hero-row">
          <div className="numeral numeral--hero">
            <span className="num-roll" key={live.totalPowerW}>
              {fmtInt(live.totalPowerW)}
            </span>
            <span className="unit">W</span>
          </div>
          <Sparkline values={sparkRef.current} />
        </div>
        <div className="hero-sub">
          <span className="mono-value">≈ {totalAmps.toFixed(1)} A</span>
          <span className="mono-value">PF {avgPf.toFixed(2)} avg</span>
          <span className="mono-value" style={{ color: 'var(--ink-3)' }}>
            50 Hz nominal
          </span>
        </div>
      </section>

      {/* 2 — load gauge */}
      <section className="card col-5" aria-label="Load versus capacity">
        <div className="card-head">
          <span className="mono-label">Load vs capacity</span>
        </div>
        <LoadGauge watts={live.totalPowerW} capacityW={CAPACITY_W} />
      </section>

      {/* 3 — phase distribution */}
      <section className="card col-5" aria-label="Phase distribution">
        <div className="card-head">
          <span className="mono-label">Phase distribution</span>
          <span className="mono-value" style={{ fontSize: 11.5 }}>
            L1 · L2 · L3
          </span>
        </div>
        <PhaseBars live={live} />
      </section>

      {/* 5 — daily energy + cost */}
      <section className="card col-4" aria-label="Energy today">
        <div className="card-head">
          <span className="mono-label">Energy today</span>
        </div>
        <div className="numeral numeral--big">
          {fmtKwh(live.dailyKwh)}
          <span className="unit">kWh</span>
        </div>
        <div className="stat-caption">
          <span className="mono-value" style={{ color: 'var(--ink-3)' }}>
            since 00:00
          </span>
        </div>

        <div style={{ borderTop: '1px solid var(--hairline)', margin: '18px 0' }} />

        <div className="card-head" style={{ marginBottom: 8 }}>
          <span className="mono-label">Cost today</span>
        </div>
        <div className="numeral numeral--big">
          <span className="unit" style={{ marginLeft: 0, marginRight: '0.18em' }}>₦</span>
          {fmtInt(live.costNaira)}
        </div>
        <div className="stat-caption">
          <span className="mono-value" style={{ color: 'var(--ink-3)' }}>
            @ ₦{TARIFF_NAIRA_PER_KWH} / kWh
          </span>
        </div>
      </section>

      {/* 6 — appliance activity */}
      <section className="card col-3" aria-label="Appliance activity">
        <div className="card-head">
          <span className="mono-label">Appliance</span>
        </div>
        <Pill
          tone={
            live.applianceLabel.includes(' ON')
              ? 'green'
              : live.applianceLabel.startsWith('Contactor')
                ? 'red'
                : 'neutral'
          }
        >
          {live.applianceLabel}
        </Pill>
        <div style={{ marginTop: 16 }}>
          <EventTimeline events={events.slice(0, 4)} now={live.lastUpdate} />
        </div>
      </section>

      {/* 4 — power history */}
      <section className="card col-8 chart-card" aria-label="Power history">
        <div className="card-head">
          <span className="mono-label">Power history</span>
          <RangeSelector value={range} onChange={setRange} />
        </div>
        {historyLoading ? (
          <div className="empty-note mono-value" style={{ height: 260, display: 'grid', placeItems: 'center' }}>
            Loading history…
          </div>
        ) : (
          <PowerAreaChart points={historyPoints} range={range} />
        )}
      </section>

      {/* admin only — 4 col right rail */}
      {user?.role === 'admin' ? (
        <div className="col-4" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--gap)' }}>
          <ContactorCard live={live} control={control} onRequest={requestContactor} />
        </div>
      ) : (
        <section className="card col-4" aria-label="Recent activity">
          <div className="card-head">
            <span className="mono-label">Recent activity</span>
          </div>
          <EventTimeline events={events.slice(0, 6)} now={live.lastUpdate} />
        </section>
      )}
    </div>
  );
}

import { useEffect, useMemo, useState } from 'react';
import { getDataSource } from '../lib/dataSource';
import type { EventItem, HistoryPoint, RangeKey } from '../lib/types';
import { RANGE_MS } from '../lib/types';
import { downloadCsv, fmtDateTime, fmtInt, fmtKwh, fmtNaira } from '../lib/format';
import { RangeSelector } from '../components/PowerAreaChart';
import { Donut } from '../components/Donut';
import { Pill } from '../components/Pill';
import { DownloadIcon } from '../components/Icons';

type Tab = 'telemetry' | 'events';

export function HistoryPage() {
  const [tab, setTab] = useState<Tab>('telemetry');
  const [range, setRange] = useState<RangeKey>('24h');
  const [history, setHistory] = useState<HistoryPoint[]>([]);
  const [events, setEvents] = useState<EventItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const src = await getDataSource();
        const to = Date.now();
        const from = to - RANGE_MS[range];
        const [h, e] = await Promise.all([
          src.fetchHistoryBetween(from, to),
          src.fetchEventsBetween(from, to),
        ]);
        if (!cancelled) {
          setHistory(h);
          setEvents(e);
          setLoading(false);
        }
      } catch (err) {
        console.error('history/events fetch failed', err);
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load history.');
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [range]);

  /** kWh per phase across the selected range (trapezoid-free simple sum). */
  const phaseKwh = useMemo<[number, number, number]>(() => {
    if (history.length < 2) return [0, 0, 0];
    let wh1 = 0;
    let wh2 = 0;
    let wh3 = 0;
    for (let i = 1; i < history.length; i++) {
      const dtH = (history[i].ts - history[i - 1].ts) / 3_600_000;
      wh1 += history[i].phases.L1 * dtH;
      wh2 += history[i].phases.L2 * dtH;
      wh3 += history[i].phases.L3 * dtH;
    }
    return [wh1 / 1000, wh2 / 1000, wh3 / 1000];
  }, [history]);

  const totalKwh = phaseKwh[0] + phaseKwh[1] + phaseKwh[2];

  const exportCsv = () => {
    if (tab === 'telemetry') {
      downloadCsv(`hems-history-${range}.csv`, [
        ['ts_iso', 'avg_power_w', 'l1_w', 'l2_w', 'l3_w', 'daily_kwh', 'cost_naira'],
        ...history.map((h) => [
          new Date(h.ts).toISOString(),
          h.avgPowerW,
          h.phases.L1,
          h.phases.L2,
          h.phases.L3,
          h.dailyKwh,
          h.costNaira,
        ]),
      ]);
    } else {
      downloadCsv(`hems-events-${range}.csv`, [
        ['ts_iso', 'type', 'appliance', 'event', 'power_w'],
        ...events.map((e) => [
          new Date(e.ts).toISOString(),
          e.type,
          e.appliance ?? '',
          e.event ?? '',
          e.powerW,
        ]),
      ]);
    }
  };

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">History &amp; logs</h1>
          <p style={{ color: 'var(--ink-2)', fontSize: 13.5, marginTop: 2 }}>
            Downsampled telemetry (60 s aggregates) and NILM events.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <RangeSelector value={range} onChange={setRange} />
          <button className="btn btn--ghost-sm" onClick={exportCsv} disabled={loading}>
            <DownloadIcon size={13} />
            CSV
          </button>
        </div>
      </div>

      <div className="grid-home">
        <section className="card col-4" aria-label="Energy by phase" style={{ alignSelf: 'start' }}>
          <div className="card-head">
            <span className="mono-label">Energy by phase · {range.toUpperCase()}</span>
          </div>
          <Donut values={phaseKwh} totalLabel="KWH" totalValue={totalKwh} />
        </section>

        <section className="card col-8">
          <div className="card-head">
            <div className="seg" role="tablist" aria-label="Log type">
              <button
                role="tab"
                aria-selected={tab === 'telemetry'}
                className={`seg-btn${tab === 'telemetry' ? ' is-active' : ''}`}
                onClick={() => setTab('telemetry')}
              >
                TELEMETRY
              </button>
              <button
                role="tab"
                aria-selected={tab === 'events'}
                className={`seg-btn${tab === 'events' ? ' is-active' : ''}`}
                onClick={() => setTab('events')}
              >
                EVENTS
              </button>
            </div>
            <span className="mono-value" style={{ fontSize: 11.5 }}>
              {loading ? '…' : tab === 'telemetry' ? `${history.length} rows` : `${events.length} rows`}
            </span>
          </div>

          <div className="table-wrap">
            {tab === 'telemetry' ? (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Time</th>
                    <th className="num">Avg W</th>
                    <th className="num">L1</th>
                    <th className="num">L2</th>
                    <th className="num">L3</th>
                    <th className="num">kWh</th>
                    <th className="num">₦</th>
                  </tr>
                </thead>
                <tbody>
                  {[...history].reverse().slice(0, 120).map((h) => (
                    <tr key={h.id}>
                      <td>{fmtDateTime(h.ts)}</td>
                      <td className="num">{fmtInt(h.avgPowerW)}</td>
                      <td className="num">{fmtInt(h.phases.L1)}</td>
                      <td className="num">{fmtInt(h.phases.L2)}</td>
                      <td className="num">{fmtInt(h.phases.L3)}</td>
                      <td className="num">{fmtKwh(h.dailyKwh)}</td>
                      <td className="num">{fmtNaira(h.costNaira)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Type</th>
                    <th>Detail</th>
                    <th className="num">Power</th>
                  </tr>
                </thead>
                <tbody>
                  {events.slice(0, 150).map((e) => (
                    <tr key={e.id}>
                      <td>{fmtDateTime(e.ts)}</td>
                      <td>
                        {e.type === 'high_load' ? (
                          <Pill tone="amber">HIGH LOAD</Pill>
                        ) : e.event === 'ON' ? (
                          <Pill tone="green">ON</Pill>
                        ) : (
                          <Pill tone="neutral">OFF</Pill>
                        )}
                      </td>
                      <td>{e.type === 'high_load' ? 'threshold crossed' : e.appliance}</td>
                      <td className="num">{fmtInt(e.powerW)} W</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {error ? (
            <div className="empty-note mono-value" style={{ color: 'var(--tint-red-fg)' }}>{error}</div>
          ) : (
            !loading &&
            ((tab === 'telemetry' && history.length === 0) || (tab === 'events' && events.length === 0)) && (
              <div className="empty-note mono-value">Nothing recorded in this range</div>
            )
          )}
        </section>
      </div>
    </div>
  );
}

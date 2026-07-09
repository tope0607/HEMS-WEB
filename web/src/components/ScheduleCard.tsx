import { useEffect, useState } from 'react';
import { DEFAULT_SCHEDULE, hhmm, parseHHMM, type Schedule } from '../lib/types';
import { fmtClock } from '../lib/format';
import { Pill } from './Pill';
import { CheckIcon } from './Icons';

interface ScheduleCardProps {
  schedule: Schedule | null;
  onSave(next: Omit<Schedule, 'requestedBy' | 'requestedAt'>): Promise<void>;
}

/**
 * Admin-only daily power schedule. The admin sets a turn-ON and turn-OFF time;
 * the ESP32 enforces them on-device using its own clock (NTP + DS3231), so the
 * schedule holds even with the web app closed or WiFi down. Times are the
 * device's local time (Lagos, UTC+1).
 */
export function ScheduleCard({ schedule, onSave }: ScheduleCardProps) {
  const s = schedule ?? DEFAULT_SCHEDULE;

  const [enabled, setEnabled] = useState(s.enabled);
  const [onStr, setOnStr] = useState(hhmm(s.onHour, s.onMinute));
  const [offStr, setOffStr] = useState(hhmm(s.offHour, s.offMinute));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // adopt server values when they arrive/change, unless the user is mid-edit
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (!schedule || dirty) return;
    setEnabled(schedule.enabled);
    setOnStr(hhmm(schedule.onHour, schedule.onMinute));
    setOffStr(hhmm(schedule.offHour, schedule.offMinute));
  }, [schedule, dirty]);

  const mark = (fn: () => void) => {
    fn();
    setDirty(true);
    setSaved(false);
  };

  const save = async () => {
    setSaving(true);
    setSaved(false);
    const on = parseHHMM(onStr);
    const off = parseHHMM(offStr);
    try {
      await onSave({
        enabled,
        onHour: on.h,
        onMinute: on.m,
        offHour: off.h,
        offMinute: off.m,
      });
      setDirty(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="card" data-testid="schedule-card">
      <div className="card-head">
        <span className="mono-label">Power schedule</span>
        {s.enabled ? <Pill tone="blue">ACTIVE</Pill> : <Pill tone="neutral" dot={false}>OFF</Pill>}
      </div>

      <label className="sched-toggle">
        <span>
          <span style={{ fontWeight: 600, fontSize: 14 }}>Automatic on/off</span>
          <span className="tl-sub" style={{ display: 'block' }}>
            Contactor follows the schedule daily
          </span>
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          className={`switch${enabled ? ' is-on' : ''}`}
          onClick={() => mark(() => setEnabled((v) => !v))}
        >
          <span className="switch-knob" />
        </button>
      </label>

      <div className="sched-times" aria-disabled={!enabled}>
        <label className="sched-field">
          <span className="mono-label">Power ON at</span>
          <input
            type="time"
            value={onStr}
            disabled={!enabled}
            onChange={(e) => mark(() => setOnStr(e.target.value))}
          />
        </label>
        <label className="sched-field">
          <span className="mono-label">Power OFF at</span>
          <input
            type="time"
            value={offStr}
            disabled={!enabled}
            onChange={(e) => mark(() => setOffStr(e.target.value))}
          />
        </label>
      </div>

      <button className="btn btn--primary btn--block" onClick={() => void save()} disabled={saving || !dirty}>
        {saving && <span className="spinner" />}
        {saved ? (
          <>
            <CheckIcon size={15} /> Saved
          </>
        ) : saving ? (
          'Saving…'
        ) : (
          'Save schedule'
        )}
      </button>

      <div className="hold-hint mono-value" style={{ fontSize: 11.5 }}>
        {s.enabled
          ? `on ${fmtClock(new Date().setHours(s.onHour, s.onMinute, 0, 0))} · off ${fmtClock(
              new Date().setHours(s.offHour, s.offMinute, 0, 0)
            )} · device local time`
          : 'schedule inactive — contactor is manual only'}
      </div>
    </div>
  );
}

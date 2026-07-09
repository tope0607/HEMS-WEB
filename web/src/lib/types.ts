export type Role = 'admin' | 'user' | 'device';

export interface PhaseReading {
  p: number; // active power, W
  v: number; // volts
  i: number; // amps
  pf: number; // power factor
}

/** Mirror of RTDB /live — overwritten by the ESP32 every 5 s. */
export interface LiveData {
  totalPowerW: number;
  phases: { L1: PhaseReading; L2: PhaseReading; L3: PhaseReading };
  dailyKwh: number;
  costNaira: number;
  applianceLabel: string;
  contactorState: 0 | 1;
  highLoad: boolean;
  lastUpdate: number; // epoch ms
  deviceOnline: boolean;
}

/** Mirror of RTDB /control/contactor — written by admins only. */
export interface ControlState {
  state: 0 | 1;
  requestedBy: string;
  requestedAt: number;
}

/** Mirror of RTDB /control/schedule — daily contactor on/off times, admin-only.
 *  The ESP32 enforces this on-device using its own clock (NTP + DS3231), so it
 *  works even with the web app closed. Times are local (device TZ), 24-hour. */
export interface Schedule {
  enabled: boolean;
  onHour: number; // 0–23
  onMinute: number; // 0–59
  offHour: number; // 0–23
  offMinute: number; // 0–59
  requestedBy: string;
  requestedAt: number;
}

export const DEFAULT_SCHEDULE: Schedule = {
  enabled: false,
  onHour: 8,
  onMinute: 0,
  offHour: 18,
  offMinute: 0,
  requestedBy: '',
  requestedAt: 0,
};

/** "HH:MM" ⇄ Schedule field helpers for the time inputs. */
export function hhmm(h: number, m: number): string {
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
export function parseHHMM(s: string): { h: number; m: number } {
  const [h, m] = s.split(':').map((x) => parseInt(x, 10));
  return { h: Number.isFinite(h) ? h : 0, m: Number.isFinite(m) ? m : 0 };
}

/** Firestore history/{autoId} — downsampled 60 s aggregate. */
export interface HistoryPoint {
  id: string;
  ts: number;
  avgPowerW: number;
  dailyKwh: number;
  costNaira: number;
  phases: { L1: number; L2: number; L3: number };
}

/** Firestore events/{autoId} — NILM transitions + high-load alerts. */
export interface EventItem {
  id: string;
  ts: number;
  type: 'appliance' | 'high_load';
  appliance?: string;
  event?: 'ON' | 'OFF';
  powerW: number;
}

export type RangeKey = '1h' | '24h' | '7d';

export const RANGE_MS: Record<RangeKey, number> = {
  '1h': 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
};

/** Time after which /live is considered stale even if deviceOnline reads true.
 *  The ESP32 client library speaks REST/SSE, where RTDB's server-side
 *  onDisconnect() isn't available — staleness is the reliable offline signal. */
export const DEVICE_STALE_MS = 20_000;

export function isDeviceLive(live: LiveData | null, now = Date.now()): boolean {
  return !!live && live.deviceOnline && now - live.lastUpdate < DEVICE_STALE_MS;
}

export interface SessionUser {
  uid: string;
  email: string;
  displayName: string;
  role: Role;
}

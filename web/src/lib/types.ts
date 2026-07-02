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

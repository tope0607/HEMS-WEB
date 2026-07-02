import type { DataSource } from './dataSource';
import type { ControlState, EventItem, HistoryPoint, LiveData, PhaseReading, RangeKey } from './types';
import { RANGE_MS } from './types';
import { CAPACITY_W, HIGH_LOAD_FRACTION, TARIFF_NAIRA_PER_KWH } from './config';

/**
 * DemoSource — a deterministic simulated three-phase building.
 *
 * Every appliance runs on hashed time-slots, so "history" and "live" agree,
 * charts look organic, and reloading the page replays the same building.
 * The contactor round-trip (pending → device confirm) is simulated with a
 * 1.4 s delay, exactly like the real ESP32 path.
 *
 * URL helpers for demos/screenshots:
 *   ?demo-highload=1  → forces the high-load state
 *   ?demo-offline=1   → simulates the ESP32 dropping off
 */

type PhaseId = 'L1' | 'L2' | 'L3';

interface Appliance {
  name: string;
  seed: number;
  phase: PhaseId;
  watts: number;
  slotMin: number; // scheduling granularity
  pf: number;
  duty: (hour: number) => number; // probability the slot is ON
}

const between = (h: number, a: number, b: number) => h >= a && h < b;

const APPLIANCES: Appliance[] = [
  {
    name: 'Fridge', seed: 11, phase: 'L1', watts: 145, slotMin: 12, pf: 0.85,
    duty: () => 0.44,
  },
  {
    name: 'Kettle', seed: 23, phase: 'L2', watts: 1850, slotMin: 4, pf: 0.99,
    duty: (h) => (between(h, 6.5, 8.5) ? 0.28 : between(h, 12, 14) ? 0.2 : between(h, 18.5, 21) ? 0.24 : 0.03),
  },
  {
    name: 'Air conditioner', seed: 37, phase: 'L3', watts: 1250, slotMin: 25, pf: 0.9,
    duty: (h) => (between(h, 11, 17) ? 0.75 : between(h, 19, 23) ? 0.55 : 0.05),
  },
  {
    name: 'Water pump', seed: 41, phase: 'L1', watts: 780, slotMin: 15, pf: 0.87,
    duty: (h) => (between(h, 5.5, 7.5) ? 0.5 : between(h, 17, 19) ? 0.4 : 0.03),
  },
  {
    name: 'TV & entertainment', seed: 53, phase: 'L2', watts: 160, slotMin: 45, pf: 0.93,
    duty: (h) => (between(h, 17.5, 23.5) ? 0.85 : 0.05),
  },
  {
    name: 'Washing machine', seed: 67, phase: 'L3', watts: 480, slotMin: 35, pf: 0.8,
    duty: (h) => (between(h, 10, 13) ? 0.3 : 0.02),
  },
  {
    name: 'Electric cooker', seed: 79, phase: 'L2', watts: 3200, slotMin: 18, pf: 0.98,
    duty: (h) => (between(h, 6.5, 8) ? 0.35 : between(h, 12, 13.5) ? 0.4 : between(h, 18, 20) ? 0.5 : 0.01),
  },
  {
    name: 'Water heater', seed: 97, phase: 'L3', watts: 2800, slotMin: 22, pf: 0.99,
    duty: (h) => (between(h, 5.5, 8) ? 0.5 : between(h, 19.5, 22.5) ? 0.4 : 0.02),
  },
];

function hash01(seed: number, n: number): number {
  let h = (Math.imul(seed, 0x9e3779b1) ^ n) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 4294967296;
}

const hourOf = (t: number) => {
  const d = new Date(t);
  return d.getHours() + d.getMinutes() / 60;
};

const midnightOf = (t: number) => {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

function slotOf(a: Appliance, t: number): number {
  return Math.floor(t / (a.slotMin * 60_000));
}

function isOn(a: Appliance, t: number): boolean {
  const slot = slotOf(a, t);
  const slotStart = slot * a.slotMin * 60_000;
  return hash01(a.seed, slot) < a.duty(hourOf(slotStart));
}

/** Base load (lights, router, standby) with a slow wander. */
function baseLoadAt(t: number): number {
  const bucket = Math.floor(t / (5 * 60_000));
  const wander = 0.85 + 0.3 * hash01(7919, bucket);
  const breathe = 1 + 0.06 * Math.sin(t / 222_000);
  return 205 * wander * breathe;
}

const BASE_SPLIT: Record<PhaseId, number> = { L1: 0.45, L2: 0.3, L3: 0.25 };

function phasePowersAt(t: number): Record<PhaseId, number> {
  const base = baseLoadAt(t);
  const out: Record<PhaseId, number> = {
    L1: base * BASE_SPLIT.L1,
    L2: base * BASE_SPLIT.L2,
    L3: base * BASE_SPLIT.L3,
  };
  for (const a of APPLIANCES) {
    if (isOn(a, t)) out[a.phase] += a.watts * (0.97 + 0.06 * hash01(a.seed + 1, Math.floor(t / 60_000)));
  }
  return out;
}

const totalOf = (p: Record<PhaseId, number>) => p.L1 + p.L2 + p.L3;

/** kWh accumulated since local midnight, sampled every 5 min. */
function dailyKwhAt(t: number): number {
  const start = midnightOf(t);
  let wh = 0;
  const step = 5 * 60_000;
  for (let m = start; m < t; m += step) {
    const dt = Math.min(step, t - m);
    wh += (totalOf(phasePowersAt(m)) * dt) / 3_600_000;
  }
  return wh / 1000;
}

function voltageAt(phase: PhaseId, t: number): number {
  const k = phase === 'L1' ? 0 : phase === 'L2' ? 1 : 2;
  return 229.5 + 2.6 * Math.sin(t / 480_000 + k * 2.1) + 1.4 * (hash01(300 + k, Math.floor(t / 30_000)) - 0.5);
}

function pfOfPhase(phase: PhaseId, t: number): number {
  // blended pf of what's running on the phase
  let pSum = BASE_SPLIT[phase] * baseLoadAt(t);
  let weighted = pSum * 0.92;
  for (const a of APPLIANCES) {
    if (a.phase === phase && isOn(a, t)) {
      pSum += a.watts;
      weighted += a.watts * a.pf;
    }
  }
  return pSum > 0 ? Math.min(0.99, weighted / pSum) : 0;
}

function applianceEventsBetween(from: number, to: number): EventItem[] {
  const events: EventItem[] = [];
  for (const a of APPLIANCES) {
    if (a.watts < 200) continue; // NILM can't see small loads reliably
    const slotMs = a.slotMin * 60_000;
    const first = Math.floor(from / slotMs);
    const last = Math.floor(to / slotMs);
    for (let s = first; s <= last; s++) {
      const tEdge = s * slotMs;
      if (tEdge < from || tEdge > to) continue;
      const prev = isOn(a, tEdge - slotMs);
      const cur = isOn(a, tEdge);
      if (prev !== cur) {
        events.push({
          id: `${a.seed}-${s}`,
          ts: tEdge,
          type: 'appliance',
          appliance: a.name,
          event: cur ? 'ON' : 'OFF',
          powerW: Math.round(totalOf(phasePowersAt(tEdge))),
        });
      }
    }
  }
  // high-load crossings, scanned at 5-min resolution
  const threshold = CAPACITY_W * HIGH_LOAD_FRACTION;
  const step = 5 * 60_000;
  let prevHigh = totalOf(phasePowersAt(from - step)) >= threshold;
  for (let m = Math.ceil(from / step) * step; m <= to; m += step) {
    const high = totalOf(phasePowersAt(m)) >= threshold;
    if (high && !prevHigh) {
      events.push({
        id: `hl-${m}`,
        ts: m,
        type: 'high_load',
        powerW: Math.round(totalOf(phasePowersAt(m))),
      });
    }
    prevHigh = high;
  }
  return events.sort((x, y) => y.ts - x.ts);
}

const urlFlag = (name: string) =>
  typeof window !== 'undefined' && new URLSearchParams(window.location.search).get(name) === '1';

export class DemoSource implements DataSource {
  readonly kind = 'demo' as const;

  private contactor: 0 | 1;
  private control: ControlState;
  private kwhLostToday = 0;
  private offSinceKwh: number | null = null;
  private lostDay: number;

  private liveSubs = new Set<(l: LiveData | null) => void>();
  private controlSubs = new Set<(c: ControlState | null) => void>();
  private eventSubs = new Map<(e: EventItem[]) => void, number>();
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    const saved = typeof localStorage !== 'undefined' ? localStorage.getItem('hems-demo-contactor') : null;
    this.contactor = saved === '0' ? 0 : 1;
    this.control = { state: this.contactor, requestedBy: 'seed', requestedAt: Date.now() - 60_000 };
    this.lostDay = midnightOf(Date.now());
  }

  private snapshot(now = Date.now()): LiveData {
    if (this.lostDay !== midnightOf(now)) {
      this.lostDay = midnightOf(now);
      this.kwhLostToday = 0;
      if (this.offSinceKwh !== null) this.offSinceKwh = 0;
    }

    const open = this.contactor === 0;
    const powers = phasePowersAt(now);
    const jitter = 1 + 0.02 * (hash01(1717, Math.floor(now / 2500)) - 0.5);

    const mkPhase = (id: PhaseId): PhaseReading => {
      const v = voltageAt(id, now);
      if (open) return { p: 0, v: Math.round(v * 10) / 10, i: 0, pf: 0 };
      const p = powers[id] * jitter;
      const pf = pfOfPhase(id, now);
      return {
        p: Math.round(p),
        v: Math.round(v * 10) / 10,
        i: Math.round((p / (v * pf)) * 100) / 100,
        pf: Math.round(pf * 100) / 100,
      };
    };

    const phases = { L1: mkPhase('L1'), L2: mkPhase('L2'), L3: mkPhase('L3') };
    const totalPowerW = open ? 0 : Math.round(totalOf(powers) * jitter);

    // displayed kWh = simulated accumulation minus energy "lost" while the
    // contactor was open; while open the display freezes at offSinceKwh.
    const dailyKwh = open && this.offSinceKwh !== null
      ? this.offSinceKwh
      : Math.max(0, dailyKwhAt(now) - this.kwhLostToday);

    // most recent NILM-visible transition within 12 min → the live label
    let applianceLabel = 'Idle · base load';
    if (open) {
      applianceLabel = 'Contactor open';
    } else {
      const recent = applianceEventsBetween(now - 12 * 60_000, now).find((e) => e.type === 'appliance');
      if (recent?.appliance) {
        const conf = 88 + Math.round(hash01(555, recent.ts) * 9);
        applianceLabel = `${recent.appliance} ${recent.event} (${conf}%)`;
      }
    }

    return {
      totalPowerW,
      phases,
      dailyKwh: Math.round(dailyKwh * 100) / 100,
      costNaira: Math.round(dailyKwh * TARIFF_NAIRA_PER_KWH * 100) / 100,
      applianceLabel,
      contactorState: this.contactor,
      highLoad: urlFlag('demo-highload') || (!open && totalPowerW >= CAPACITY_W * HIGH_LOAD_FRACTION),
      lastUpdate: now,
      deviceOnline: !urlFlag('demo-offline'),
    };
  }

  private ensureTicking() {
    if (this.timer) return;
    this.timer = setInterval(() => {
      if (this.liveSubs.size === 0 && this.eventSubs.size === 0) {
        clearInterval(this.timer!);
        this.timer = null;
        return;
      }
      const snap = this.snapshot();
      this.liveSubs.forEach((cb) => cb(snap));
      const now = Date.now();
      this.eventSubs.forEach((limit, cb) => cb(applianceEventsBetween(now - 48 * 3600_000, now).slice(0, limit)));
    }, 2500);
  }

  subscribeLive(cb: (l: LiveData | null) => void): () => void {
    this.liveSubs.add(cb);
    cb(this.snapshot());
    this.ensureTicking();
    return () => this.liveSubs.delete(cb);
  }

  subscribeControl(cb: (c: ControlState | null) => void): () => void {
    this.controlSubs.add(cb);
    cb(this.control);
    return () => this.controlSubs.delete(cb);
  }

  async requestContactor(state: 0 | 1, uid: string): Promise<void> {
    this.control = { state, requestedBy: uid, requestedAt: Date.now() };
    this.controlSubs.forEach((cb) => cb(this.control));
    // simulated device round-trip: stream → actuate → confirm into /live
    setTimeout(() => {
      const now = Date.now();
      if (state === 0 && this.contactor === 1) {
        this.offSinceKwh = Math.max(0, dailyKwhAt(now) - this.kwhLostToday);
      }
      if (state === 1 && this.contactor === 0 && this.offSinceKwh !== null) {
        this.kwhLostToday = Math.max(0, dailyKwhAt(now) - this.offSinceKwh);
        this.offSinceKwh = null;
      }
      this.contactor = state;
      try {
        localStorage.setItem('hems-demo-contactor', String(state));
      } catch {
        /* private mode */
      }
      const snap = this.snapshot();
      this.liveSubs.forEach((cb) => cb(snap));
    }, 1400);
  }

  async fetchHistory(range: RangeKey): Promise<HistoryPoint[]> {
    const to = Date.now();
    return this.fetchHistoryBetween(to - RANGE_MS[range], to);
  }

  async fetchHistoryBetween(from: number, to: number): Promise<HistoryPoint[]> {
    const span = to - from;
    const step = span <= RANGE_MS['1h'] ? 60_000 : span <= RANGE_MS['24h'] ? 10 * 60_000 : 60 * 60_000;
    const points: HistoryPoint[] = [];
    for (let t = Math.ceil(from / step) * step; t <= to; t += step) {
      const powers = phasePowersAt(t);
      points.push({
        id: `h-${t}`,
        ts: t,
        avgPowerW: Math.round(totalOf(powers)),
        dailyKwh: Math.round(dailyKwhAt(t) * 100) / 100,
        costNaira: Math.round(dailyKwhAt(t) * TARIFF_NAIRA_PER_KWH * 100) / 100,
        phases: {
          L1: Math.round(powers.L1),
          L2: Math.round(powers.L2),
          L3: Math.round(powers.L3),
        },
      });
    }
    return points;
  }

  subscribeEvents(limit: number, cb: (events: EventItem[]) => void): () => void {
    this.eventSubs.set(cb, limit);
    const now = Date.now();
    cb(applianceEventsBetween(now - 48 * 3600_000, now).slice(0, limit));
    this.ensureTicking();
    return () => this.eventSubs.delete(cb);
  }

  async fetchEventsBetween(from: number, to: number): Promise<EventItem[]> {
    return applianceEventsBetween(from, to);
  }
}

import { getDatabase, onValue, ref, set } from 'firebase/database';
import {
  collection,
  getDocs,
  getFirestore,
  limit as qLimit,
  onSnapshot,
  orderBy,
  query,
  where,
} from 'firebase/firestore';
import type { DataSource } from './dataSource';
import type { ControlState, EventItem, HistoryPoint, LiveData, RangeKey } from './types';
import { RANGE_MS } from './types';
import { getFirebaseApp } from './firebase';

/**
 * Firebase-backed data source.
 *
 * Free-tier discipline:
 *  - /live and /control are RTDB listeners (not metered per read on Spark);
 *  - history/ is a bounded one-shot Firestore query per range change — never
 *    a realtime listener on high-frequency data;
 *  - events/ carries one small realtime listener (a handful of writes/day).
 */
export class FirebaseSource implements DataSource {
  readonly kind = 'firebase' as const;

  private db = getDatabase(getFirebaseApp());
  private fs = getFirestore(getFirebaseApp());

  subscribeLive(cb: (live: LiveData | null) => void): () => void {
    return onValue(
      ref(this.db, 'live'),
      (snap) => cb(snap.exists() ? (snap.val() as LiveData) : null),
      () => cb(null)
    );
  }

  subscribeControl(cb: (control: ControlState | null) => void): () => void {
    return onValue(
      ref(this.db, 'control/contactor'),
      (snap) => cb(snap.exists() ? (snap.val() as ControlState) : null),
      () => cb(null)
    );
  }

  async requestContactor(state: 0 | 1, uid: string): Promise<void> {
    // Security rules enforce: admins only, requestedBy must equal caller uid.
    await set(ref(this.db, 'control/contactor'), {
      state,
      requestedBy: uid,
      requestedAt: Date.now(),
    });
  }

  async fetchHistory(range: RangeKey): Promise<HistoryPoint[]> {
    const to = Date.now();
    return this.fetchHistoryBetween(to - RANGE_MS[range], to);
  }

  async fetchHistoryBetween(from: number, to: number): Promise<HistoryPoint[]> {
    const snap = await getDocs(
      query(
        collection(this.fs, 'history'),
        where('ts', '>=', from),
        where('ts', '<=', to),
        orderBy('ts', 'asc'),
        qLimit(11000) // 7d of 60s docs ≈ 10 080 — hard ceiling for safety
      )
    );
    return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<HistoryPoint, 'id'>) }));
  }

  subscribeEvents(limit: number, cb: (events: EventItem[]) => void): () => void {
    return onSnapshot(
      query(collection(this.fs, 'events'), orderBy('ts', 'desc'), qLimit(limit)),
      (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<EventItem, 'id'>) }))),
      () => cb([])
    );
  }

  async fetchEventsBetween(from: number, to: number): Promise<EventItem[]> {
    const snap = await getDocs(
      query(
        collection(this.fs, 'events'),
        where('ts', '>=', from),
        where('ts', '<=', to),
        orderBy('ts', 'desc'),
        qLimit(2000)
      )
    );
    return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<EventItem, 'id'>) }));
  }
}

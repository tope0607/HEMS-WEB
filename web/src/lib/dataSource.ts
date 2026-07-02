import type { ControlState, EventItem, HistoryPoint, LiveData, RangeKey } from './types';
import { DEMO_MODE } from './config';

/**
 * One interface, two backings:
 *  - FirebaseSource: RTDB /live + /control, Firestore history/ + events/
 *  - DemoSource: a fully simulated building, so the UI runs (and can be
 *    demoed / screenshotted) without a device or Firebase project.
 *
 * Free-tier discipline is encoded in the shape of this interface: live data is
 * a *subscription to a single overwritten node*, history is a *bounded fetch*
 * of downsampled aggregates, and only the low-frequency events list may hold a
 * realtime Firestore listener.
 */
export interface DataSource {
  readonly kind: 'demo' | 'firebase';
  subscribeLive(cb: (live: LiveData | null) => void): () => void;
  subscribeControl(cb: (control: ControlState | null) => void): () => void;
  /** Admin-only by security rules; rejects for other roles. */
  requestContactor(state: 0 | 1, uid: string): Promise<void>;
  fetchHistory(range: RangeKey): Promise<HistoryPoint[]>;
  fetchHistoryBetween(from: number, to: number): Promise<HistoryPoint[]>;
  /** Latest N events, newest first, kept live (low write volume ⇒ cheap). */
  subscribeEvents(limit: number, cb: (events: EventItem[]) => void): () => void;
  fetchEventsBetween(from: number, to: number): Promise<EventItem[]>;
}

let instance: DataSource | null = null;

export async function getDataSource(): Promise<DataSource> {
  if (instance) return instance;
  if (DEMO_MODE) {
    const { DemoSource } = await import('./demoSource');
    instance = new DemoSource();
  } else {
    const { FirebaseSource } = await import('./firebaseSource');
    instance = new FirebaseSource();
  }
  return instance;
}

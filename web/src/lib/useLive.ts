import { useEffect, useState } from 'react';
import { getDataSource } from './dataSource';
import type { ControlState, LiveData, Schedule } from './types';

/** Subscribes to /live, /control/contactor and /control/schedule for the
 *  lifetime of the caller. */
export function useLive(): {
  live: LiveData | null;
  control: ControlState | null;
  schedule: Schedule | null;
} {
  const [live, setLive] = useState<LiveData | null>(null);
  const [control, setControl] = useState<ControlState | null>(null);
  const [schedule, setSchedule] = useState<Schedule | null>(null);

  useEffect(() => {
    let unsubLive: (() => void) | undefined;
    let unsubControl: (() => void) | undefined;
    let unsubSchedule: (() => void) | undefined;
    let cancelled = false;
    (async () => {
      const src = await getDataSource();
      if (cancelled) return;
      unsubLive = src.subscribeLive(setLive);
      unsubControl = src.subscribeControl(setControl);
      unsubSchedule = src.subscribeSchedule(setSchedule);
    })();
    return () => {
      cancelled = true;
      unsubLive?.();
      unsubControl?.();
      unsubSchedule?.();
    };
  }, []);

  return { live, control, schedule };
}

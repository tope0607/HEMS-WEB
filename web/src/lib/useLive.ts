import { useEffect, useState } from 'react';
import { getDataSource } from './dataSource';
import type { ControlState, LiveData } from './types';

/** Subscribes to /live and /control/contactor for the lifetime of the caller. */
export function useLive(): { live: LiveData | null; control: ControlState | null } {
  const [live, setLive] = useState<LiveData | null>(null);
  const [control, setControl] = useState<ControlState | null>(null);

  useEffect(() => {
    let unsubLive: (() => void) | undefined;
    let unsubControl: (() => void) | undefined;
    let cancelled = false;
    (async () => {
      const src = await getDataSource();
      if (cancelled) return;
      unsubLive = src.subscribeLive(setLive);
      unsubControl = src.subscribeControl(setControl);
    })();
    return () => {
      cancelled = true;
      unsubLive?.();
      unsubControl?.();
    };
  }, []);

  return { live, control };
}

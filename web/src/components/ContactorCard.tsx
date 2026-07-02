import { useEffect, useRef, useState } from 'react';
import type { ControlState, LiveData } from '../lib/types';
import { fmtClock } from '../lib/format';
import { Pill } from './Pill';
import { PowerIcon } from './Icons';

const HOLD_MS = 1200;
const CONFIRM_TIMEOUT_MS = 12_000;

type FlowState = 'idle' | 'pending' | 'failed';

interface ContactorCardProps {
  live: LiveData;
  control: ControlState | null;
  onRequest(state: 0 | 1): Promise<void>;
}

/**
 * Admin-only master contactor control.
 * Press-and-hold IS the confirm step (this switches real building power):
 * hold for 1.2 s to arm the write; releasing early cancels. After the write
 * the card shows PENDING until the ESP32 confirms via /live/contactorState,
 * or FAILED if no confirmation arrives in time.
 */
export function ContactorCard({ live, control, onRequest }: ContactorCardProps) {
  const isOn = live.contactorState === 1;
  const target: 0 | 1 = isOn ? 0 : 1;

  const [flow, setFlow] = useState<FlowState>('idle');
  const [holding, setHolding] = useState(false);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const failTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // device confirmation: /live/contactorState catches up with the request
  useEffect(() => {
    if (flow === 'pending' && control && live.contactorState === control.state) {
      setFlow('idle');
      if (failTimer.current) clearTimeout(failTimer.current);
    }
  }, [flow, control, live.contactorState]);

  useEffect(
    () => () => {
      if (holdTimer.current) clearTimeout(holdTimer.current);
      if (failTimer.current) clearTimeout(failTimer.current);
    },
    []
  );

  const beginHold = () => {
    if (flow === 'pending' || !live.deviceOnline) return;
    setHolding(true);
    holdTimer.current = setTimeout(async () => {
      setHolding(false);
      setFlow('pending');
      if (failTimer.current) clearTimeout(failTimer.current);
      failTimer.current = setTimeout(() => setFlow('failed'), CONFIRM_TIMEOUT_MS);
      try {
        await onRequest(target);
      } catch {
        if (failTimer.current) clearTimeout(failTimer.current);
        setFlow('failed');
      }
    }, HOLD_MS);
  };

  const cancelHold = () => {
    setHolding(false);
    if (holdTimer.current) {
      clearTimeout(holdTimer.current);
      holdTimer.current = null;
    }
  };

  const statusPill =
    flow === 'pending' ? (
      <Pill tone="amber" pulse>
        CONFIRMING…
      </Pill>
    ) : flow === 'failed' ? (
      <Pill tone="red">FAILED</Pill>
    ) : isOn ? (
      <Pill tone="green">ENERGIZED</Pill>
    ) : (
      <Pill tone="red">OPEN</Pill>
    );

  return (
    <div className="card" data-testid="contactor-card">
      <div className="card-head">
        <span className="mono-label">Master contactor</span>
        {statusPill}
      </div>

      <div className="contactor-state-row">
        <div>
          <div className="contactor-word">{isOn ? 'Power on' : 'Power cut'}</div>
          <div className="tl-sub">Feeds the entire building — confirm deliberately.</div>
        </div>
      </div>

      {flow === 'failed' && (
        <div className="form-error" role="alert">
          <span style={{ marginTop: 1 }}>
            <PowerIcon size={14} />
          </span>
          <span>
            The device didn’t confirm the switch. Check that the ESP32 is online, then try
            again.
          </span>
        </div>
      )}

      <button
        className={`hold-btn ${target === 1 ? 'hold-btn--on' : 'hold-btn--off'}${holding ? ' is-holding' : ''}`}
        style={{ ['--hold-ms' as string]: `${HOLD_MS}ms` }}
        disabled={flow === 'pending' || !live.deviceOnline}
        onPointerDown={beginHold}
        onPointerUp={cancelHold}
        onPointerLeave={cancelHold}
        onPointerCancel={cancelHold}
        onKeyDown={(e) => {
          if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) beginHold();
        }}
        onKeyUp={cancelHold}
        aria-label={`Hold to switch contactor ${target === 1 ? 'on' : 'off'}`}
      >
        <span className="hold-fill" />
        <PowerIcon size={17} />
        {flow === 'pending'
          ? 'Waiting for device…'
          : `Hold to switch ${target === 1 ? 'ON' : 'OFF'}`}
      </button>

      <div className="hold-hint mono-value" style={{ fontSize: 11.5 }}>
        {live.deviceOnline
          ? `press and hold ${(HOLD_MS / 1000).toFixed(1)}s — releasing early cancels`
          : 'device offline — control unavailable'}
      </div>

      {control && (
        <div className="contactor-meta">
          <span className="mono-value" style={{ fontSize: 11.5 }}>
            last request → {control.state === 1 ? 'ON' : 'OFF'} at {fmtClock(control.requestedAt)}
          </span>
          <span className="mono-value" style={{ fontSize: 11.5 }}>
            by {control.requestedBy.slice(0, 10)}
          </span>
        </div>
      )}
    </div>
  );
}

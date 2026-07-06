"""Per-phase event detector.

Decides when a genuine load-switching step has occurred and measures it
cleanly. It is a steady-state tracker: a valid delta only exists between
two settled plateaus, so it waits for the signal to settle into a new
level before emitting (level_new - level_old).

Parameters
----------
settle_window : how many consecutive 1 Hz samples must be stable to call a
                new plateau. Longer = more robust to transients/flicker but
                more chance of missing a 2nd event during settling.
steady_band_w : max peak-to-peak wobble (W) within the window to count as
                "steady". Set from measured baseline noise.
dp_min_w      : smallest power step (W) to treat as an event. THIS is the
                line between 'detectable appliance' and 'background': set it
                just above the noise floor so fans (~50-80 W) register but
                LED bulbs / chargers fall into the residual by design.
"""
from collections import deque


class PhaseEventDetector:
    def __init__(self, phase, settle_window=4, steady_band_w=8.0, dp_min_w=35.0):
        self.phase = phase
        self.W = int(settle_window)
        self.eps = float(steady_band_w)
        self.dp_min = float(dp_min_w)
        self.bufP = deque(maxlen=self.W)
        self.bufQ = deque(maxlen=self.W)
        self.baseP = None      # current settled plateau (active power)
        self.baseQ = 0.0       # reactive power at that plateau

    def _settled(self):
        return len(self.bufP) == self.W and (max(self.bufP) - min(self.bufP)) <= self.eps

    def process(self, t, p, q):
        """Feed one sample. Returns an event dict or None.

        event = {t, phase, dP, dQ, sign, level_p}
        """
        self.bufP.append(p)
        self.bufQ.append(q)

        if not self._settled():
            return None  # still in a transition; wait for a new plateau

        level_p = sum(self.bufP) / self.W
        level_q = sum(self.bufQ) / self.W

        if self.baseP is None:
            # first stable plateau -> establish baseline, no event
            self.baseP, self.baseQ = level_p, level_q
            return None

        dP = level_p - self.baseP
        if abs(dP) > self.dp_min:
            ev = {
                "t": t,
                "phase": self.phase,
                "dP": dP,
                "dQ": level_q - self.baseQ,
                "sign": 1 if dP > 0 else -1,
                "level_p": level_p,
            }
            self.baseP, self.baseQ = level_p, level_q
            return ev

        # settled but within dp_min: track slow drift, emit nothing
        self.baseP, self.baseQ = level_p, level_q
        return None

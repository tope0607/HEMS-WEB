"""Per-phase energy attribution with reconciliation.

Tracks which appliances are currently ON, accrues their energy, and uses the
residual (measured power minus the sum of assigned powers) to stay honest:

* small steady positive residual  -> undetected background (bulbs/chargers)
* large negative residual          -> a missed OFF edge; self-correct by
                                      closing the appliance that best explains
                                      the overshoot
* power back at quiescent baseline  -> hard resync, clear the active set
                                      (offices closed -> can't drift overnight)

Energy is accrued per sample so still-ON appliances are counted correctly.
Unknown (rejected) events are tracked as anonymous loads so they neither
corrupt named appliances nor distort the residual; their energy is reported
under 'unknown'.
"""


class PhaseAttributor:
    def __init__(self, phase, dt=1.0, quiescent_w=45.0, over_attribution_tol_w=90.0, bg_nominal_w=0.0):
        self.phase = phase
        self.dt = float(dt)
        self.quiescent = float(quiescent_w)
        self.over_tol = float(over_attribution_tol_w)
        self.bg_nominal = float(bg_nominal_w)
        self.active = []            # [{label, power, q}]
        self.energy = {}            # label -> Wh  (named appliances)
        self.background_wh = 0.0    # sub-threshold loads
        self.unknown_wh = 0.0       # detected-but-unclassified
        self._unknown_id = 0
        self._neg_run = 0           # consecutive samples of strong over-attribution

    def _accrue(self, label, wh):
        if label.startswith("unknown"):
            self.unknown_wh += wh
        else:
            self.energy[label] = self.energy.get(label, 0.0) + wh

    def on_event(self, ev, label):
        if ev["sign"] > 0:  # turn-ON
            if label == "unknown":
                label = "unknown_%d" % self._unknown_id
                self._unknown_id += 1
            self.active.append({"label": label, "power": abs(ev["dP"]), "q": abs(ev["dQ"])})
        else:               # turn-OFF: close the matching active load
            target = abs(ev["dP"])
            same = [a for a in self.active if a["label"] == label]
            if same:                       # same appliance type is active -> lenient match
                best = min(same, key=lambda a: abs(a["power"] - target))
                if abs(best["power"] - target) <= 0.30 * target + 25:
                    self.active.remove(best)
            elif self.active:              # no same-label: only on a TIGHT power match
                best = min(self.active, key=lambda a: abs(a["power"] - target))
                if abs(best["power"] - target) <= 0.12 * target + 15:
                    self.active.remove(best)
                # else: orphan/merged off -> ignore; corrector/resync reconciles

    def step(self, t, measured_p):
        """Advance one sample. Returns the current residual (W)."""
        for a in self.active:
            self._accrue(a["label"], a["power"] * self.dt / 3600.0)

        assigned = sum(a["power"] for a in self.active)
        residual = measured_p - assigned

        if residual > 0:                       # leftover -> background
            self.background_wh += residual * self.dt / 3600.0

        if residual < -self.over_tol and self.active:   # possible missed OFF
            self._neg_run += 1
        else:
            self._neg_run = 0

        if self._neg_run >= 3 and self.active:   # sustained -> self-correct
            # the always-present background floor means measured sits above the
            # named loads; fold it in so the overshoot points at the load that
            # actually switched off (e.g. a 120 W fridge, not a 65 W fan).
            overshoot = -residual + self.bg_nominal
            best = min(self.active, key=lambda a: abs(a["power"] - overshoot))
            if abs(best["power"] - overshoot) <= 0.4 * overshoot:
                self.active.remove(best)
                self._neg_run = 0

        if measured_p <= self.quiescent and self.active:  # hard resync
            self.active = []

        return residual

    def report(self):
        return {
            "named_wh": dict(self.energy),
            "unknown_wh": self.unknown_wh,
            "background_wh": self.background_wh,
        }

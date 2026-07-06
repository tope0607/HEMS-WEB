"""NILM pipeline: wires the per-phase detector -> classifier -> attributor.

Feed it one timestamped multi-phase sample at a time via process_sample().
The same object works whether samples come from the simulator, a recorded
CSV replay, or live MQTT off the ESP32 - only the source changes.
"""
from .event_detector import PhaseEventDetector
from .attribution import PhaseAttributor


class NILMPipeline:
    def __init__(self, classifier, phase_map, cfg):
        self.classifier = classifier
        self.phase_map = phase_map               # {phase: [labels present]}
        ed = cfg["event_detector"]
        at = cfg["attribution"]
        dt = cfg.get("sample_period_s", 1.0)
        self.detectors = {
            ph: PhaseEventDetector(ph, ed["settle_window"], ed["steady_band_w"], ed["dp_min_w"])
            for ph in cfg["phases"]
        }
        bg = cfg.get("background_w", {})
        self.attributors = {
            ph: PhaseAttributor(ph, dt, at["quiescent_baseline_w"],
                                at["over_attribution_tol_w"], bg.get(ph, 0.0))
            for ph in cfg["phases"]
        }
        self.events = []                         # full event log

    def process_sample(self, t, readings):
        """readings: {phase: {'P': float, 'Q': float}}"""
        for ph, r in readings.items():
            det = self.detectors[ph]
            ev = det.process(t, r["P"], r["Q"])
            if ev is not None:
                allowed = self.phase_map.get(ph)
                label, dist = self.classifier.predict(ev["dP"], ev["dQ"], allowed)
                self.attributors[ph].on_event(ev, label)
                self.events.append({**ev, "label": label, "dist": round(dist, 3)})
            self.attributors[ph].step(t, r["P"])

    def report(self):
        return {ph: self.attributors[ph].report() for ph in self.attributors}

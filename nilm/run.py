"""Run the engine over a recorded day (CSV replay) or live MQTT, then score it.

  python run.py                       # replay day_stream.csv, score vs ground_truth.json
  python run.py --mqtt localhost      # subscribe to live samples from the ESP32
  python run.py --events              # also print the per-event log

Scoring uses the simulator's ground truth (and the PZEM's own cumulative
energy register as the denominator) to report, per phase: how much measured
energy was correctly attributed to named appliances, vs background/unknown.
"""
import argparse
import csv
import json

from nilm import KNNClassifier, NILMPipeline, load_config, phase_map_from_config


def make_pipeline():
    cfg = load_config()
    clf = KNNClassifier.load("model.json")
    pm = phase_map_from_config(cfg)
    return NILMPipeline(clf, pm, cfg), cfg


def replay(show_events):
    pipe, cfg = make_pipeline()
    phases = cfg["phases"]
    with open("day_stream.csv") as f:
        for r in csv.DictReader(f):
            t = float(r["t"])
            readings = {ph: {"P": float(r[f"P_{ph}"]), "Q": float(r[f"Q_{ph}"])} for ph in phases}
            pipe.process_sample(t, readings)
    score(pipe, show_events)


def live(host, show_events):
    import paho.mqtt.client as mqtt
    pipe, cfg = make_pipeline()

    def on_msg(c, u, m):
        d = json.loads(m.payload)
        readings = {ph: {"P": v["P"], "Q": v["Q"]} for ph, v in d["phases"].items()}
        pipe.process_sample(d["t"], readings)

    cli = mqtt.Client()
    cli.on_message = on_msg
    cli.connect(host, 1883, 60)
    cli.subscribe("hems/samples")
    print("listening on hems/samples ... Ctrl-C to stop and score")
    try:
        cli.loop_forever()
    except KeyboardInterrupt:
        score(pipe, show_events)


def score(pipe, show_events):
    rep = pipe.report()
    try:
        truth = json.load(open("ground_truth.json"))
    except FileNotFoundError:
        truth = None

    if show_events:
        print("\n--- EVENT LOG ---")
        for e in pipe.events:
            print("t=%6.0fs  %s  dP=%+8.1fW  dQ=%+8.1fVAR  -> %-16s (d=%.2f)"
                  % (e["t"], e["phase"], e["dP"], e["dQ"], e["label"], e["dist"]))

    print("\n--- ENERGY ATTRIBUTION (Wh) ---")
    grand_meas = grand_named = 0.0
    for ph in pipe.attributors:
        r = rep[ph]
        named = r["named_wh"]
        meas = truth["phase_total_wh"][ph] if truth else (
            sum(named.values()) + r["unknown_wh"] + r["background_wh"])
        grand_meas += meas
        grand_named += sum(named.values())
        print("\nPhase %s   (measured total %.0f Wh)" % (ph, meas))
        if truth:
            print("  %-18s %10s %10s" % ("appliance", "true", "estimated"))
            for lab in sorted(set(list(named) + [k for k in truth["appliance_wh"]
                                                 if k in pipe.phase_map[ph]])):
                tv = truth["appliance_wh"].get(lab, 0.0)
                ev = named.get(lab, 0.0)
                print("  %-18s %9.0f  %9.0f" % (lab, tv, ev))
        else:
            for lab, ev in sorted(named.items()):
                print("  %-18s %9.0f Wh" % (lab, ev))
        print("  %-18s %19.0f Wh" % ("[unknown]", r["unknown_wh"]))
        print("  %-18s %19.0f Wh" % ("[background/other]", r["background_wh"]))

    if grand_meas:
        print("\nNamed-appliance energy attributed: %.0f / %.0f Wh  (%.1f%%)"
              % (grand_named, grand_meas, 100.0 * grand_named / grand_meas))


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--mqtt", default=None)
    ap.add_argument("--events", action="store_true")
    a = ap.parse_args()
    if a.mqtt:
        live(a.mqtt, a.events)
    else:
        replay(a.events)

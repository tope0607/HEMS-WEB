"""Data simulator. Lets the whole engine run and be validated WITHOUT hardware.

Two modes:

  python simulator.py characterize
      For each trained appliance, toggle it in isolation many times and record
      the (label, dP, dQ) of each on/off -> characterization.csv. This is the
      synthetic stand-in for the bench-characterisation campaign; when hardware
      arrives, replace this file with deltas measured from a real PZEM.

  python simulator.py day [--hours H] [--mqtt host]
      Synthesise a full working-day 3-phase stream at 1 Hz with cycling,
      scheduled and burst loads, an untrained kettle, background, and
      measurement noise -> day_stream.csv, plus ground_truth.json (true
      per-appliance energy) for scoring.

Output stream columns per phase p: P_p, Q_p, V_p, I_p, PF_p, E_p (cumulative Wh).
"""
import argparse
import csv
import json
import math
import random

from nilm.signal import q_from_pf

random.seed(7)

CFG = json.load(open("config.json"))
DT = CFG["sample_period_s"]
VNOM = CFG["voltage_nominal"]
NOISE_FRAC = 0.004      # ~0.4% PZEM measurement noise
NOISE_ABS = 0.6         # small absolute noise floor (W)


def noisy(x):
    if x <= 0:
        return max(0.0, random.gauss(0, NOISE_ABS))
    return max(0.0, x + random.gauss(0, NOISE_FRAC * x + NOISE_ABS))


def build_state(label, spec, n, total):
    """Return a boolean on/off array of length n for one appliance."""
    b = spec["behavior"]
    on = [False] * n
    w = b.get("window", [0.0, 1.0])
    lo, hi = int(w[0] * n), int(w[1] * n)

    if b["type"] == "scheduled":
        # real offices don't switch everything at the same second; jitter the
        # on/off instants so co-scheduled loads produce separable events.
        lo = min(hi, lo + random.randint(20, 240))
        hi = max(lo, hi - random.randint(20, 240))
        for k in range(lo, hi):
            on[k] = True

    elif b["type"] == "cycling":
        k = lo
        state = False
        # randomise the first dwell so phases of different cyclers don't align
        dwell = random.randint(0, b["off_s"])
        while k < hi:
            seg = b["on_s"] if state else b["off_s"]
            seg = min(seg if dwell == 0 else dwell, hi - k)
            for j in range(k, k + seg):
                on[j] = state
            k += seg
            dwell = 0
            state = not state

    elif b["type"] == "burst":
        for _ in range(b["n"]):
            dur = random.randint(b["dur_s"][0], b["dur_s"][1])
            start = random.randint(lo, max(lo, hi - dur))
            for j in range(start, min(start + dur, n)):
                on[j] = True

    return on


def all_specs():
    specs = dict(CFG["appliances"])
    specs.update(CFG.get("untrained_loads", {}))
    return specs


def characterize(reps=40):
    rows = []
    for label, spec in CFG["appliances"].items():
        p, q = spec["p_w"], q_from_pf(spec["p_w"], spec["pf"])
        for _ in range(reps):
            # ON delta and OFF delta, each measured against a noisy baseline
            on_dp = noisy(p) - noisy(0)
            on_dq = noisy(q) - noisy(0)
            rows.append([label, round(on_dp, 2), round(on_dq, 2)])
            off_dp = noisy(0) - noisy(p)
            off_dq = noisy(0) - noisy(q)
            rows.append([label, round(off_dp, 2), round(off_dq, 2)])
    with open("characterization.csv", "w", newline="") as f:
        wtr = csv.writer(f)
        wtr.writerow(["label", "dP", "dQ"])
        wtr.writerows(rows)
    print("wrote characterization.csv  (%d samples, %d appliances)"
          % (len(rows), len(CFG["appliances"])))


def day(hours=6.0, mqtt_host=None):
    n = int(hours * 3600 / DT)
    specs = all_specs()
    states = {lab: build_state(lab, sp, n, hours) for lab, sp in specs.items()}
    powers = {lab: (sp["p_w"], q_from_pf(sp["p_w"], sp["pf"])) for lab, sp in specs.items()}

    truth_wh = {lab: 0.0 for lab in specs}
    energy_cum = {ph: 0.0 for ph in CFG["phases"]}
    bg = CFG["background_w"]

    client = None
    if mqtt_host:
        import paho.mqtt.client as mqtt
        client = mqtt.Client()
        client.connect(mqtt_host, 1883, 60)

    f = open("day_stream.csv", "w", newline="")
    wtr = csv.writer(f)
    header = ["t"]
    for ph in CFG["phases"]:
        header += [f"P_{ph}", f"Q_{ph}", f"V_{ph}", f"I_{ph}", f"PF_{ph}", f"E_{ph}"]
    wtr.writerow(header)

    for k in range(n):
        t = k * DT
        row = [t]
        sample = {}
        for ph in CFG["phases"]:
            P = bg[ph] + random.gauss(0, 3)      # background (sub-threshold)
            Q = 0.0
            for lab, sp in specs.items():
                if sp["phase"] == ph and states[lab][k]:
                    p, q = powers[lab]
                    P += p
                    Q += q
                    truth_wh[lab] += p * DT / 3600.0
            P = noisy(P)
            Q = max(0.0, Q + random.gauss(0, NOISE_FRAC * Q + NOISE_ABS))
            V = VNOM + random.gauss(0, 1.5)
            S = math.sqrt(P * P + Q * Q)
            I = S / V if V else 0.0
            PF = P / S if S else 1.0
            energy_cum[ph] += P * DT / 3600.0
            row += [round(P, 2), round(Q, 2), round(V, 2), round(I, 3), round(PF, 3), round(energy_cum[ph], 3)]
            sample[ph] = {"P": P, "Q": Q}
        wtr.writerow(row)
        if client:
            client.publish("hems/samples", json.dumps({"t": t, "phases": sample}))
    f.close()

    truth = {
        "appliance_wh": {k: round(v, 1) for k, v in truth_wh.items()},
        "phase_total_wh": {k: round(v, 1) for k, v in energy_cum.items()},
        "untrained": list(CFG.get("untrained_loads", {}).keys()),
    }
    json.dump(truth, open("ground_truth.json", "w"), indent=2)
    print("wrote day_stream.csv  (%d samples x %d phases, %.1f h)"
          % (n, len(CFG["phases"]), hours))
    print("wrote ground_truth.json")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("mode", choices=["characterize", "day"])
    ap.add_argument("--hours", type=float, default=6.0)
    ap.add_argument("--mqtt", default=None, help="MQTT broker host to publish live")
    a = ap.parse_args()
    if a.mode == "characterize":
        characterize()
    else:
        day(a.hours, a.mqtt)

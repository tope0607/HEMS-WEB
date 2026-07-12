"""Latency test → event-to-cloud-confirm table + per-trial figure.

The firmware stamps a millis() id when the NILM detector registers a ΔP
transition (`#LAT,detect,<id>,<dP>`) and echoes that id when the corresponding
Firebase write is confirmed (`#LAT,confirm,<id>,<confirm_ms>`). Cloud-update
latency = confirm_ms − id.

Scope note printed with the table: this measures detection→cloud-write-confirmed.
The extra display lag on the dashboard's /live path is bounded by the 5 s
publish cadence by design, and the physical-switch→ΔP portion is bounded by the
detector's settle window (settle_window × 1 s) — neither is a bench measurement,
so we don't present them as one.
"""
import numpy as np
import pandas as pd

import common


def run(buckets, results_dir):
    rows = buckets.get("LAT", [])
    if not rows:
        return common.nodata("latency",
                             "no #LAT rows — toggle a trained appliance during a capture (Test 3)")

    detect, confirm = {}, {}
    for r in rows:
        if len(r) < 2:
            continue
        kind = r[0].strip()
        if kind == "detect" and len(r) >= 2:
            detect[r[1].strip()] = common.to_float(r[2]) if len(r) >= 3 else float("nan")
        elif kind == "confirm" and len(r) >= 3:
            confirm[r[1].strip()] = common.to_float(r[2])

    recs = []
    for i, (eid, dP) in enumerate(detect.items(), 1):
        if eid in confirm:
            lat = confirm[eid] - common.to_float(eid)
            if np.isfinite(lat) and lat >= 0:
                recs.append({"trial": i, "event_id": eid, "dP_W": dP,
                             "cloud_latency_ms": round(lat, 0)})

    unmatched = len(detect) - len(recs)
    if not recs:
        return common.nodata("latency",
                             f"{len(detect)} detections but no matched confirms "
                             "(Firebase writes may have failed — check #COMM)")

    table = pd.DataFrame(recs)
    lat = table["cloud_latency_ms"]
    stats = pd.DataFrame([{
        "metric": "event→cloud-confirm latency (ms)",
        "n": int(lat.size),
        "mean": round(float(lat.mean()), 0),
        "median": round(float(lat.median()), 0),
        "min": round(float(lat.min()), 0),
        "max": round(float(lat.max()), 0),
        "std": round(float(lat.std(ddof=0)), 0),
    }])

    print("\n== Latency (event → cloud confirm) ==")
    common.save_table(table, f"{results_dir}/latency_trials.csv")
    common.save_table(stats, f"{results_dir}/latency_summary.csv")
    if unmatched:
        print(f"  ({unmatched} detection(s) had no matching write-confirm — excluded)")
    print("  scope: detection→cloud-write-confirmed only. /live display adds up to the "
          "5 s publish interval; physical→ΔP adds up to the detector settle window.")

    common.style()
    import matplotlib.pyplot as plt
    fig, ax = plt.subplots(figsize=(6.4, 3.8))
    ax.bar(table["trial"], table["cloud_latency_ms"], color="0.6",
           edgecolor="black", width=0.7)
    ax.axhline(float(lat.mean()), ls="--", color="black", lw=1,
               label=f"mean {lat.mean():.0f} ms")
    ax.axhline(float(lat.median()), ls=":", color="black", lw=1,
               label=f"median {lat.median():.0f} ms")
    ax.set_xlabel("Trial")
    ax.set_ylabel("Cloud-update latency (ms)")
    ax.set_title("Event detection → dashboard update latency")
    ax.legend()
    common.save_fig(fig, f"{results_dir}/latency.png")

    return {"mean_latency_ms": round(float(lat.mean()), 0), "trials": int(lat.size)}

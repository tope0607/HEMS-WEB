"""Accuracy test → rated-value comparison table + % error figure.

Reads the #DATA telemetry rows that were tagged with a load (via the `LOAD
<name> <ratedW>` serial command). For each tagged load, the "system reading"
is the mean total real power over that load's window; % error is against the
manufacturer RATED wattage — never against another meter (I have no calibrated
reference). Some error is physical, not sensor inaccuracy: resistive loads draw
P ∝ V², so at a low mains voltage a kettle/iron legitimately pulls below
nameplate. That caveat is printed with the table.
"""
import numpy as np
import pandas as pd

import common

COLS = ["iso", "phase", "voltage_v", "current_a", "power_w", "energy_wh",
        "pf", "load_label", "rated_w"]


def _frame(rows):
    recs = []
    for r in rows:
        r = (r + [""] * len(COLS))[:len(COLS)]
        recs.append(r)
    df = pd.DataFrame(recs, columns=COLS)
    for c in ["voltage_v", "current_a", "power_w", "energy_wh", "pf", "rated_w"]:
        df[c] = pd.to_numeric(df[c], errors="coerce")
    df["load_label"] = df["load_label"].astype(str).str.strip()
    return df


def run(buckets, results_dir):
    rows = buckets.get("DATA", [])
    if not rows:
        return common.nodata("accuracy",
                             "no #DATA rows — run the CSV-telemetry capture (Test 1/2)")

    df = _frame(rows)
    tagged = df[(df["load_label"] != "") & (df["load_label"].str.lower() != "off")
                & df["rated_w"].notna() & (df["rated_w"] > 0)]
    if tagged.empty:
        return common.nodata("accuracy",
                             "no LOAD-tagged rows — issue `LOAD <name> <ratedW>` before each load")

    out = []
    for label, g in tagged.groupby("load_label"):
        # total real power per sample instant, then the window mean
        per_sample = g.groupby("iso")["power_w"].sum()
        reading = float(per_sample.mean())
        rated = float(g["rated_w"].iloc[0])
        err = abs(reading - rated) / rated * 100.0
        out.append({
            "Load type": label,
            "Rated power (W)": round(rated, 0),
            "System reading (W)": round(reading, 1),
            "% error": round(err, 2),
            "samples": int(per_sample.size),
        })

    table = pd.DataFrame(out).sort_values("Load type").reset_index(drop=True)
    mean_err = float(table["% error"].mean())

    print("\n== Accuracy (rated-value comparison) ==")
    common.save_table(table, f"{results_dir}/accuracy.csv")
    print(f"  overall mean % error: {mean_err:.2f}%")
    print("  note: % error vs MANUFACTURER RATED wattage (no calibrated reference "
          "meter). Resistive loads at low mains voltage draw below nameplate "
          "(P ∝ V²), so part of the error is physical, not sensor inaccuracy.")

    # figure: % error per load
    common.style()
    import matplotlib.pyplot as plt
    fig, ax = plt.subplots(figsize=(6.4, 3.8))
    bars = ax.bar(table["Load type"], table["% error"],
                  color="0.6", edgecolor="black", width=0.6)
    for b, v in zip(bars, table["% error"]):
        ax.text(b.get_x() + b.get_width() / 2, v, f"{v:.1f}%",
                ha="center", va="bottom", fontsize=9)
    ax.axhline(mean_err, ls="--", color="black", lw=1,
               label=f"mean {mean_err:.1f}%")
    ax.set_ylabel("Absolute error vs rated (%)")
    ax.set_title("HEMS metering accuracy by load")
    ax.legend()
    fig.autofmt_xdate(rotation=20)
    common.save_fig(fig, f"{results_dir}/accuracy.png")

    return {"mean_error_pct": round(mean_err, 2), "loads_tested": int(table.shape[0])}

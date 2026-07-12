"""Energy-savings projection — ILLUSTRATIVE, never a measured building result.

There is no before/after building dataset (bench-scale testing only). This
projects the reduction the contactor scheduling WOULD yield from a stated
standby load and a duty-cycle assumption you provide. Every assumption is
printed in the output and the artifact is hard-labelled "illustrative
projection". If a real measured baseline exists in the capture, it's used for
the baseline; the duty cycle remains an assumption either way.
"""
import pandas as pd

import common


def run(buckets, results_dir, standby_w=None, hours_cut_per_day=None,
        baseline_kwh_per_day=None, tariff=68.0):
    if standby_w is None or hours_cut_per_day is None:
        return common.nodata(
            "savings",
            "supply --standby-w and --hours-cut to project (illustrative). "
            "e.g. --standby-w 50 --hours-cut 10")

    # baseline: prefer a measured daily figure if given; else derive from the
    # capture's mean total power if telemetry exists; else leave blank.
    derived = None
    data = buckets.get("DATA", [])
    if baseline_kwh_per_day is None and data:
        import numpy as np
        # mean total power (W) across the capture → kWh/day
        per = {}
        for r in data:
            if len(r) >= 5 and r[0] != "timestamp_iso":
                per.setdefault(r[0], 0.0)
                per[r[0]] += common.to_float(r[4], 0.0)
        if per:
            mean_w = float(np.mean(list(per.values())))
            derived = mean_w * 24.0 / 1000.0

    baseline = baseline_kwh_per_day if baseline_kwh_per_day is not None else derived

    saved_kwh_day = standby_w / 1000.0 * hours_cut_per_day
    rows = [
        ("ASSUMPTION: standby load cut (W)", standby_w),
        ("ASSUMPTION: hours/day contactor cuts power", hours_cut_per_day),
        ("Projected energy saved (kWh/day)", round(saved_kwh_day, 3)),
        ("Projected energy saved (kWh/month, 30d)", round(saved_kwh_day * 30, 2)),
        (f"Projected cost saved (₦/month @ ₦{tariff:.0f}/kWh)",
         round(saved_kwh_day * 30 * tariff, 0)),
    ]
    if baseline:
        rows.append(("Baseline (kWh/day)"
                     + (" — derived from capture" if baseline_kwh_per_day is None
                        else " — provided"), round(baseline, 3)))
        rows.append(("Projected reduction (% of baseline)",
                     round(100.0 * saved_kwh_day / baseline, 1)))

    table = pd.DataFrame(rows, columns=["quantity", "value"])
    print("\n== Energy-savings projection  [ILLUSTRATIVE — NOT a measured result] ==")
    common.save_table(table, f"{results_dir}/savings_projection.csv")
    print("  This is a projection from the stated assumptions above, not a "
          "measured before/after building comparison.")
    out = {"projected_saving_kwh_day": round(saved_kwh_day, 3), "illustrative": True}
    if baseline:
        out["projected_reduction_pct"] = round(100.0 * saved_kwh_day / baseline, 1)
    return out

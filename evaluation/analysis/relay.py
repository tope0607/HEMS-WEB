"""Relay/contactor switching test → success rate + summary.

Reads #RLY trial rows (`#RLY,<trial>,<commanded>,<confirmed>,<result>`). The
firmware commands the contactor, waits a settle interval, and reads the state
back from the largest per-phase PZEM current (there is no dedicated feedback
pin, so current is the proxy: a load must sit downstream of the contactor).
Success = the read-back state matched the commanded state.
"""
import pandas as pd

import common


def run(buckets, results_dir):
    rows = buckets.get("RLY", [])
    trials = [r for r in rows if r and r[0].strip().lstrip("-").isdigit() and len(r) >= 4]
    if not trials:
        return common.nodata("relay",
                             "no #RLY trial rows — run the `RELAYTEST` command (Test 4)")

    recs = []
    for r in trials:
        recs.append({
            "trial": int(r[0]),
            "commanded_state": int(common.to_float(r[1], -1)),
            "confirmed_state": int(common.to_float(r[2], -1)),
            "result": r[3].strip(),
        })
    table = pd.DataFrame(recs).sort_values("trial").reset_index(drop=True)

    n = int(table.shape[0])
    ok = int((table["result"].str.upper() == "OK").sum())
    rate = 100.0 * ok / n

    print("\n== Relay / contactor switching reliability ==")
    common.save_table(table, f"{results_dir}/relay_trials.csv")
    summary = pd.DataFrame([{"trials": n, "successes": ok,
                             "mismatches": n - ok, "success_rate_pct": round(rate, 1)}])
    common.save_table(summary, f"{results_dir}/relay_summary.csv")
    print(f"  switching reliability: {ok}/{n} = {rate:.1f}%")

    common.style()
    import matplotlib.pyplot as plt
    fig, ax = plt.subplots(figsize=(5.2, 3.8))
    counts = [ok, n - ok]
    bars = ax.bar(["match", "mismatch"], counts,
                  color=["0.6", "0.3"], edgecolor="black", width=0.55)
    for b, v in zip(bars, counts):
        ax.text(b.get_x() + b.get_width() / 2, v, str(v),
                ha="center", va="bottom", fontsize=10)
    ax.set_ylabel("Trials")
    ax.set_title(f"Contactor switching: {ok}/{n} = {rate:.0f}%")
    common.save_fig(fig, f"{results_dir}/relay.png")

    return {"switching_reliability_pct": round(rate, 1), "trials": n}

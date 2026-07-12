"""Overall summary table — assembled ONLY from tests that actually produced a
result. Anything not run shows "not run", never a number.
"""
import pandas as pd

import common


def run(metrics, results_dir):
    """metrics: {test_name: result_dict_or_None} collected from every module."""
    def cell(name, key, fmt, suffix=""):
        m = metrics.get(name)
        if not m or key not in m:
            return "not run"
        return f"{fmt.format(m[key])}{suffix}"

    rows = [
        ("System accuracy (mean % error)", cell("accuracy", "mean_error_pct", "{:.2f}", "%")),
        ("Average event→cloud latency", cell("latency", "mean_latency_ms", "{:.0f}", " ms")),
        ("Contactor switching reliability", cell("relay", "switching_reliability_pct", "{:.1f}", "%")),
        ("Firebase upload success", cell("comms", "comms_success_pct", "{:.1f}", "%")),
        ("Avg Wi-Fi reconnection time", cell("comms", "avg_reconnect_s", "{:.1f}", " s")),
        ("Controller self-power", cell("selfpower", "self_power_w", "{:.2f}", " W")),
        ("Usability (mean score /5)", cell("survey", "survey_mean", "{:.2f}")),
    ]
    table = pd.DataFrame(rows, columns=["Metric", "Result"])

    # annotate the labelled/illustrative caveats so the summary can't mislead
    sp = metrics.get("selfpower")
    if sp and sp.get("source") == "datasheet_estimate":
        table.loc[table["Metric"] == "Controller self-power", "Metric"] = \
            "Controller self-power (datasheet est.)"

    print("\n== Objective-4 summary ==")
    common.save_table(table, f"{results_dir}/summary.csv")
    return table

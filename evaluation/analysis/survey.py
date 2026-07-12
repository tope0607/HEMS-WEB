"""Usability survey → per-dimension distributions + mean scores.

Ingests a survey.csv of Likert 1–5 responses. Expected columns (case/space
insensitive, extra columns ignored):
  ease_of_use, nilm_usefulness, remote_control_satisfaction, energy_awareness
One row per respondent. If the file is absent, this SKIPS with a NO-DATA notice
— it never invents responses.
"""
import os

import numpy as np
import pandas as pd

import common

# canonical dimension -> friendly label
_DIMS = {
    "ease_of_use": "Ease of use",
    "usefulness_of_nilm": "Usefulness of NILM breakdown",
    "nilm_usefulness": "Usefulness of NILM breakdown",
    "remote_control_satisfaction": "Satisfaction with remote control",
    "satisfaction_remote_control": "Satisfaction with remote control",
    "energy_awareness": "Energy-usage awareness",
    "energy_usage_awareness": "Energy-usage awareness",
}


def _norm(col):
    return col.strip().lower().replace(" ", "_").replace("-", "_")


def run(buckets, results_dir, survey_path=None):
    if not survey_path or not os.path.exists(survey_path):
        return common.nodata(
            "usability survey",
            f"no survey.csv (looked for {survey_path or 'evaluation/logs/survey.csv'}) "
            "— collect Likert 1–5 responses to enable this")

    df = pd.read_csv(survey_path)
    df.columns = [_norm(c) for c in df.columns]
    present = [(c, _DIMS[c]) for c in df.columns if c in _DIMS]
    if not present:
        return common.nodata("usability survey",
                             f"{survey_path} has no recognised Likert columns")

    seen = {}
    for col, label in present:
        seen.setdefault(label, col)   # first column wins per label

    rows, dist_records = [], []
    for label, col in seen.items():
        vals = pd.to_numeric(df[col], errors="coerce").dropna()
        vals = vals[(vals >= 1) & (vals <= 5)]
        if vals.empty:
            continue
        rows.append({"dimension": label, "n": int(vals.size),
                     "mean": round(float(vals.mean()), 2),
                     "median": float(vals.median())})
        for score in range(1, 6):
            dist_records.append({"dimension": label, "score": score,
                                 "count": int((vals == score).sum())})

    if not rows:
        return common.nodata("usability survey", "no valid 1–5 responses found")

    means = pd.DataFrame(rows)
    dist = pd.DataFrame(dist_records)
    print("\n== Usability survey ==")
    common.save_table(means, f"{results_dir}/survey_means.csv")
    common.save_table(dist, f"{results_dir}/survey_distribution.csv")

    # grouped bar: score distribution per dimension (greyscale by score)
    common.style()
    import matplotlib.pyplot as plt
    dims = list(means["dimension"])
    x = np.arange(len(dims))
    width = 0.16
    fig, ax = plt.subplots(figsize=(7.6, 4.2))
    for i, score in enumerate(range(1, 6)):
        counts = [int(dist[(dist["dimension"] == d) & (dist["score"] == score)]["count"].sum())
                  for d in dims]
        ax.bar(x + (i - 2) * width, counts, width, label=f"{score}",
               color=common.GREYS[i % len(common.GREYS)], edgecolor="black")
    ax.set_xticks(x)
    ax.set_xticklabels(dims, rotation=15, ha="right")
    ax.set_ylabel("Respondents")
    ax.set_title("Usability survey — score distribution (1–5)")
    ax.legend(title="score", ncol=5, fontsize=8)
    common.save_fig(fig, f"{results_dir}/survey.png")

    return {"survey_mean": round(float(means["mean"].mean()), 2),
            "respondents": int(df.shape[0])}

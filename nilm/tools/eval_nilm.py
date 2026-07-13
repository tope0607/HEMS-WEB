"""Turn characterization.csv into Chapter-4 NILM results — honestly.

Produces the results that your captured (label, dP, dQ) rows genuinely support:
  1. Leave-one-out classification accuracy (overall + per class)  -> CSV
  2. Confusion matrix (LOO predictions; no training-on-test)      -> CSV + PNG
  3. (|dP|, |dQ|) feature-separation scatter                      -> PNG
  4. Metering accuracy: mean |dP| measured vs RATED nameplate     -> CSV + PNG
     (only if you pass --rated; the config p_w values are simulator
      placeholders, not your real appliances' nameplates)

  python tools/eval_nilm.py                       # accuracy + confusion + features
  python tools/eval_nilm.py --rated "Electric_iron=1000,Electric_kettle=1500,\
Soldering_iron=60,Laptop_charger=65"              # + metering accuracy

Integrity: every number is computed from characterization.csv. Leave-one-out is
used for accuracy so no sample is tested against a model trained on itself.
Nothing here needs the contactor, the network, or the harness capture — those
(latency, switching, comms, self-power) are separate tests.
"""
import argparse
import csv
import os
import sys

import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

# make the nilm/ package importable whether run from nilm/ or elsewhere
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from nilm import KNNClassifier, load_config, phase_map_from_config

MARKERS = ["o", "s", "^", "D", "v", "P", "X", "*"]
GREYS = ["0.15", "0.40", "0.60", "0.78", "0.28", "0.52", "0.70", "0.05"]


def _style():
    plt.rcParams.update({"figure.dpi": 150, "savefig.dpi": 150,
                         "savefig.bbox": "tight", "font.size": 11,
                         "axes.grid": True, "grid.color": "0.85",
                         "axes.axisbelow": True})


def load_rows(path):
    feats, labels = [], []
    with open(path) as f:
        for r in csv.DictReader(f):
            feats.append([abs(float(r["dP"])), abs(float(r["dQ"]))])
            labels.append(r["label"])
    return np.asarray(feats, float), np.asarray(labels)


def leave_one_out(X, y, cfg, k, tau):
    """LOO predictions with the same per-phase candidate restriction the
    firmware uses at inference. Returns predicted labels ('Unknown' if the
    rejection threshold fires)."""
    pm = phase_map_from_config(cfg)
    label_to_phase = {lab: ph for ph, labs in pm.items() for lab in labs}
    preds = []
    for i in range(len(X)):
        clf = KNNClassifier(k, tau)
        clf.fit(np.delete(X, i, 0), np.delete(y, i))
        allowed = pm.get(label_to_phase.get(y[i]))
        pred, _ = clf.predict(X[i, 0], X[i, 1], allowed)
        preds.append(pred if pred is not None else "Unknown")
    return np.array(preds)


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("csv", nargs="?", default="characterization.csv")
    ap.add_argument("--config", default="config.json")
    ap.add_argument("--out", default="results")
    ap.add_argument("--rated", help='comma list "Name=watts,Name=watts" (real nameplates)')
    args = ap.parse_args()

    if not os.path.exists(args.csv):
        sys.exit(f"{args.csv} not found — capture appliances first (tools/capture_serial.py)")
    cfg = load_config(args.config)
    X, y = load_rows(args.csv)
    classes = sorted(set(y))
    k = int(cfg["classifier"]["k"])
    tau = float(cfg["classifier"]["tau"])
    os.makedirs(args.out, exist_ok=True)
    _style()

    unknown_labels = set(y) - set(cfg["appliances"])
    if unknown_labels:
        sys.exit(f"labels not in config.json: {', '.join(sorted(unknown_labels))} "
                 "— fix the CSV labels or config first (see train.py)")

    # ── 1 & 2: leave-one-out accuracy + confusion matrix ──
    preds = leave_one_out(X, y, cfg, k, tau)
    overall = 100.0 * np.mean(preds == y)

    rows = [{"class": c, "n": int(np.sum(y == c)),
             "correct": int(np.sum((y == c) & (preds == c))),
             "accuracy_pct": round(100.0 * np.mean(preds[y == c] == c), 1)}
            for c in classes]
    rows.append({"class": "OVERALL", "n": int(len(y)),
                 "correct": int(np.sum(preds == y)), "accuracy_pct": round(overall, 1)})
    _write_csv(f"{args.out}/nilm_loo_accuracy.csv",
               ["class", "n", "correct", "accuracy_pct"], rows)
    print(f"\nNILM leave-one-out accuracy: {overall:.1f}%  ({len(classes)} classes, {len(y)} samples)")

    col_labels = classes + (["Unknown"] if "Unknown" in preds else [])
    cm = np.zeros((len(classes), len(col_labels)), int)
    idx = {c: i for i, c in enumerate(classes)}
    cidx = {c: i for i, c in enumerate(col_labels)}
    for t, p in zip(y, preds):
        cm[idx[t], cidx[p]] += 1
    _write_confusion_csv(f"{args.out}/nilm_confusion.csv", classes, col_labels, cm)
    _plot_confusion(f"{args.out}/nilm_confusion.png", classes, col_labels, cm)

    # ── 3: feature-separation scatter ──
    _plot_features(f"{args.out}/nilm_features.png", X, y, classes)

    # ── 4: metering accuracy (optional; needs real nameplates) ──
    if args.rated:
        rated = {}
        for pair in args.rated.split(","):
            name, _, w = pair.partition("=")
            if w:
                rated[name.strip()] = float(w)
        mrows = []
        for c in classes:
            meas = float(np.mean(X[y == c, 0]))          # mean |dP| = measured power
            if c in rated and rated[c] > 0:
                err = abs(meas - rated[c]) / rated[c] * 100.0
                mrows.append({"Load type": c, "Rated power (W)": rated[c],
                              "System reading (W)": round(meas, 1),
                              "% error": round(err, 2)})
        if mrows:
            _write_csv(f"{args.out}/metering_accuracy.csv",
                       ["Load type", "Rated power (W)", "System reading (W)", "% error"], mrows)
            mean_err = float(np.mean([r["% error"] for r in mrows]))
            print(f"metering mean % error: {mean_err:.2f}%  (measured |dP| vs rated nameplate)")
            _plot_metering(f"{args.out}/metering_accuracy.png", mrows, mean_err)
        else:
            print("no --rated names matched the CSV labels — metering table skipped")
    else:
        print("(pass --rated with real nameplate watts to also get the metering-accuracy table)")

    print(f"\nartifacts written to {os.path.abspath(args.out)}")


def _write_csv(path, cols, rows):
    with open(path, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=cols)
        w.writeheader()
        w.writerows(rows)
    print(f"  -> {path}")


def _write_confusion_csv(path, rows_lbl, col_lbl, cm):
    with open(path, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["true \\ predicted"] + col_lbl)
        for i, r in enumerate(rows_lbl):
            w.writerow([r] + list(cm[i]))
    print(f"  -> {path}")


def _plot_confusion(path, rows_lbl, col_lbl, cm):
    fig, ax = plt.subplots(figsize=(1.4 + 0.9 * len(col_lbl), 1.4 + 0.9 * len(rows_lbl)))
    ax.imshow(cm, cmap="Greys", aspect="auto")
    ax.set_xticks(range(len(col_lbl)), col_lbl, rotation=30, ha="right")
    ax.set_yticks(range(len(rows_lbl)), rows_lbl)
    thresh = cm.max() / 2 if cm.max() else 0.5
    for i in range(len(rows_lbl)):
        for j in range(len(col_lbl)):
            ax.text(j, i, cm[i, j], ha="center", va="center",
                    color="white" if cm[i, j] > thresh else "black")
    ax.set_xlabel("Predicted")
    ax.set_ylabel("Actual")
    ax.set_title("NILM confusion matrix (leave-one-out)")
    fig.tight_layout()
    fig.savefig(path)
    plt.close(fig)
    print(f"  -> {path}")


def _plot_features(path, X, y, classes):
    fig, ax = plt.subplots(figsize=(6.6, 4.4))
    for i, c in enumerate(classes):
        m = y == c
        ax.scatter(X[m, 0], X[m, 1], marker=MARKERS[i % len(MARKERS)],
                   facecolor=GREYS[i % len(GREYS)], edgecolor="black",
                   s=55, label=c)
    ax.set_xlabel("|ΔP|  (W)")
    ax.set_ylabel("|ΔQ|  (VAR)")
    ax.set_title("Appliance signatures in (ΔP, ΔQ) feature space")
    ax.legend(fontsize=8)
    fig.savefig(path)
    plt.close(fig)
    print(f"  -> {path}")


def _plot_metering(path, mrows, mean_err):
    fig, ax = plt.subplots(figsize=(6.4, 3.8))
    names = [r["Load type"] for r in mrows]
    errs = [r["% error"] for r in mrows]
    bars = ax.bar(names, errs, color="0.6", edgecolor="black", width=0.6)
    for b, v in zip(bars, errs):
        ax.text(b.get_x() + b.get_width() / 2, v, f"{v:.1f}%", ha="center", va="bottom", fontsize=9)
    ax.axhline(mean_err, ls="--", color="black", lw=1, label=f"mean {mean_err:.1f}%")
    ax.set_ylabel("Absolute error vs rated (%)")
    ax.set_title("Metering accuracy vs rated wattage")
    ax.legend()
    fig.autofmt_xdate(rotation=20)
    fig.savefig(path)
    plt.close(fig)
    print(f"  -> {path}")


if __name__ == "__main__":
    main()

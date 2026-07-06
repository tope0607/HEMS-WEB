"""Train the k-NN signature library from characterisation deltas.

  python train.py [characterization.csv] [model.json]

Reads (label, dP, dQ) rows, fits the classifier (which standardises features),
prints a data-driven tau suggestion and a leave-one-out accuracy as a sanity
check, then saves model.json. When hardware arrives, point this at a CSV of
deltas measured from a real PZEM instead of the simulator's.
"""
import csv
import sys

import numpy as np

from nilm import KNNClassifier, load_config


def main(csv_path="characterization.csv", out="model.json"):
    cfg = load_config()
    feats, labels = [], []
    with open(csv_path) as f:
        for r in csv.DictReader(f):
            feats.append([abs(float(r["dP"])), abs(float(r["dQ"]))])
            labels.append(r["label"])

    clf = KNNClassifier(k=cfg["classifier"]["k"], tau=cfg["classifier"]["tau"])
    clf.fit(feats, labels)

    print("trained on %d samples, %d classes" % (len(labels), len(set(labels))))
    print("feature means (|dP|,|dQ|):  %.1f W, %.1f VAR" % (clf.mu[0], clf.mu[1]))
    print("feature stds  (|dP|,|dQ|):  %.1f W, %.1f VAR" % (clf.sigma[0], clf.sigma[1]))
    print("configured tau = %.2f   (data-driven suggestion = %.2f)"
          % (clf.tau, clf.suggest_tau()))

    # leave-one-out accuracy (per-phase candidate restriction applied)
    from nilm import phase_map_from_config
    pm = phase_map_from_config(cfg)
    label_to_phase = {lab: ph for ph, labs in pm.items() for lab in labs}
    X, y = np.asarray(feats, float), np.asarray(labels)
    correct = 0
    for i in range(len(X)):
        sub = KNNClassifier(clf.k, clf.tau)
        sub.fit(np.delete(X, i, 0), np.delete(y, i))
        allowed = pm[label_to_phase[y[i]]]
        pred, _ = sub.predict(X[i, 0], X[i, 1], allowed)
        correct += (pred == y[i])
    print("leave-one-out accuracy: %.1f%%" % (100.0 * correct / len(X)))

    clf.save(out)
    print("saved %s" % out)


if __name__ == "__main__":
    args = sys.argv[1:]
    main(*(args or []))

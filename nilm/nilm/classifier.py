"""k-NN appliance classifier on the (|dP|, |dQ|) feature space.

Key pieces that a naive k-NN misses:

* Feature standardisation. dP runs to ~1500 W while dQ runs to a few
  hundred VAR; without scaling, dP swamps the Euclidean distance and dQ
  (the resistive-vs-inductive discriminator) is ignored. We store mu/sigma
  from the TRAINING set and apply the same transform to every query.

* Rejection threshold (tau). k-NN otherwise forces every event onto the
  nearest known class, so an untrained kettle becomes 'your fridge'. If the
  nearest neighbour is farther than tau (in standardised units), we return
  'unknown' and let the event go to the residual instead of corrupting a
  record.

* Per-phase candidate restriction. At inference each phase only compares
  against the appliances wired to it (from the electrician's phase map),
  shrinking the candidate set and cutting collisions.
"""
import json
import numpy as np


class KNNClassifier:
    def __init__(self, k=3, tau=3.0):
        self.k = int(k)
        self.tau = float(tau)
        self.mu = None
        self.sigma = None
        self.X = None      # standardised training features
        self.y = None      # labels

    # ---- training ----
    def fit(self, feats, labels):
        X = np.asarray(feats, dtype=float)          # columns: |dP|, |dQ|
        self.mu = X.mean(axis=0)
        self.sigma = X.std(axis=0)
        self.sigma[self.sigma == 0] = 1.0           # guard against zero spread
        self.X = (X - self.mu) / self.sigma
        self.y = np.asarray(labels)
        return self

    def suggest_tau(self):
        """Data-driven tau: a generous margin beyond within-class spread.

        For each training point, distance to its nearest same-class neighbour;
        tau ~ mean + 3*std of those. Printed during training as a sanity check.
        """
        ds = []
        for i in range(len(self.X)):
            same = np.where(self.y == self.y[i])[0]
            same = same[same != i]
            if len(same) == 0:
                continue
            d = np.sqrt(((self.X[same] - self.X[i]) ** 2).sum(axis=1))
            ds.append(d.min())
        if not ds:
            return self.tau
        ds = np.array(ds)
        return float(ds.mean() + 3.0 * ds.std())

    # ---- inference ----
    def _standardize(self, dp, dq):
        return (np.array([abs(dp), abs(dq)], dtype=float) - self.mu) / self.sigma

    def predict(self, dp, dq, allowed=None):
        """Return (label, nearest_distance). label='unknown' if rejected."""
        z = self._standardize(dp, dq)
        if allowed is not None:
            mask = np.isin(self.y, list(allowed))
            X, y = self.X[mask], self.y[mask]
        else:
            X, y = self.X, self.y
        if len(X) == 0:
            return "unknown", float("inf")

        d = np.sqrt(((X - z) ** 2).sum(axis=1))
        order = np.argsort(d)[: self.k]
        nd = d[order]
        if nd[0] > self.tau:
            return "unknown", float(nd[0])

        votes = {}
        for idx, dist in zip(order, nd):
            votes[y[idx]] = votes.get(y[idx], 0.0) + 1.0 / (dist + 1e-6)
        label = max(votes, key=votes.get)
        return str(label), float(nd[0])

    # ---- persistence ----
    def save(self, path):
        json.dump(
            {
                "k": self.k, "tau": self.tau,
                "mu": self.mu.tolist(), "sigma": self.sigma.tolist(),
                "X": self.X.tolist(), "y": self.y.tolist(),
            },
            open(path, "w"), indent=2,
        )

    @classmethod
    def load(cls, path):
        d = json.load(open(path))
        c = cls(d["k"], d["tau"])
        c.mu = np.array(d["mu"]); c.sigma = np.array(d["sigma"])
        c.X = np.array(d["X"]); c.y = np.array(d["y"])
        return c

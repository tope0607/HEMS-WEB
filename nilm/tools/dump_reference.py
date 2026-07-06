"""Run the Python pipeline over day_stream.csv and dump the canonical
reference (event log + energy report) the C++ parity test compares against.

  python tools/dump_reference.py [day_stream.csv] [reference.json]
"""
import csv
import json
import sys

sys.path.insert(0, ".")  # run from nilm/ so the package resolves
from nilm import KNNClassifier, NILMPipeline, load_config, phase_map_from_config  # noqa: E402


def main(stream="day_stream.csv", out="reference.json"):
    cfg = load_config()
    clf = KNNClassifier.load("model.json")
    pipe = NILMPipeline(clf, phase_map_from_config(cfg), cfg)

    phases = cfg["phases"]
    with open(stream) as f:
        for r in csv.DictReader(f):
            t = float(r["t"])
            readings = {ph: {"P": float(r["P_%s" % ph]), "Q": float(r["Q_%s" % ph])} for ph in phases}
            pipe.process_sample(t, readings)

    events = [
        {
            "t": e["t"], "phase": e["phase"], "dP": e["dP"], "dQ": e["dQ"],
            "sign": e["sign"], "label": e["label"], "dist": e["dist"],
        }
        for e in pipe.events
    ]
    report = pipe.report()
    json.dump({"events": events, "report": report}, open(out, "w"), indent=1)
    print("wrote %s  (%d events)" % (out, len(events)))


if __name__ == "__main__":
    main(*sys.argv[1:])

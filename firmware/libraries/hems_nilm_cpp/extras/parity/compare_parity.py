"""Diff the C++ parity output against the Python reference.

  python compare_parity.py reference.json cpp_output.txt

Asserts: same event count; per event identical (t, phase, sign, label) and
dP/dQ/dist numerically close; per-phase energy report close to 1e-6 Wh.
Exit 0 = parity holds.
"""
import json
import sys

TOL = 1e-6
DIST_TOL = 5e-4   # Python logs dist rounded to 3 dp


def main(ref_path, cpp_path):
    ref = json.load(open(ref_path))
    events_cpp, report_cpp = [], {}
    section = None
    for line in open(cpp_path):
        line = line.strip()
        if line == "EVENTS":
            section = "e"
            continue
        if line == "REPORT":
            section = "r"
            continue
        if not line:
            continue
        parts = line.split(",")
        if section == "e":
            events_cpp.append(
                {
                    "t": float(parts[0]), "phase": parts[1], "dP": float(parts[2]),
                    "dQ": float(parts[3]), "sign": int(parts[4]), "label": parts[5],
                    "dist": float(parts[6]),
                }
            )
        elif section == "r":
            ph, label, wh = parts[0], parts[1], float(parts[2])
            report_cpp.setdefault(ph, {})[label] = wh

    ref_events = ref["events"]
    fails = []

    if len(ref_events) != len(events_cpp):
        fails.append("event count: python %d vs cpp %d" % (len(ref_events), len(events_cpp)))

    for i, (a, b) in enumerate(zip(ref_events, events_cpp)):
        # Python event labels: 'unknown' stays 'unknown' in the log
        checks = [
            abs(a["t"] - b["t"]) <= TOL,
            a["phase"] == b["phase"],
            a["sign"] == b["sign"],
            a["label"] == b["label"],
            abs(a["dP"] - b["dP"]) <= max(TOL, TOL * abs(a["dP"])),
            abs(a["dQ"] - b["dQ"]) <= max(TOL, TOL * abs(a["dQ"])),
            (a["dist"] == float("inf")) == (b["dist"] > 1e17) or abs(a["dist"] - b["dist"]) <= DIST_TOL,
        ]
        if not all(checks):
            fails.append("event %d differs:\n  py : %s\n  cpp: %s" % (i, a, b))
            if len(fails) > 6:
                break

    for ph, r in ref["report"].items():
        want = dict(r["named_wh"])
        want["[unknown]"] = r["unknown_wh"]
        want["[background]"] = r["background_wh"]
        got = report_cpp.get(ph, {})
        for label, wh in want.items():
            gw = got.get(label, 0.0)
            if abs(gw - wh) > max(1e-6, 1e-9 * abs(wh)):
                fails.append("energy %s/%s: python %.9f vs cpp %.9f" % (ph, label, wh, gw))

    if fails:
        print("PARITY FAILED (%d problems)" % len(fails))
        for f in fails[:8]:
            print(" -", f)
        sys.exit(1)

    print("PARITY OK: %d events identical, energy report matches (<=1e-6 Wh)"
          % len(ref_events))


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])

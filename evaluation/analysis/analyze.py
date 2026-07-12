"""HEMS Objective-4 analysis pipeline.

Ingests one or more serial capture files (from evaluation/logs/) and writes
per-test tables (results/*.csv) and figures (results/*.png) for Chapter 4.

  python analyze.py --capture ../logs/session.log
  python analyze.py --capture ../logs/*.log --survey ../logs/survey.csv \
                    --standby-w 50 --hours-cut 10
  python analyze.py --capture ../logs/session.log --only accuracy latency

Integrity: every number traces to a logged reading or a labelled projection.
Tests with no data print "NO DATA — run test X" and are marked "not run" in the
summary; nothing is fabricated.
"""
import argparse
import glob
import os
import sys

import common
import accuracy
import latency
import relay
import comms
import selfpower
import savings
import survey
import summary

ALL_TESTS = ["accuracy", "latency", "relay", "comms", "selfpower",
             "savings", "survey"]


def main():
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--capture", nargs="+", required=True,
                    help="capture log file(s) or glob(s) from evaluation/logs/")
    ap.add_argument("--results-dir", default=os.path.join(os.path.dirname(__file__),
                    "..", "results"), help="where tables/figures are written")
    ap.add_argument("--survey", help="path to survey.csv (usability test)")
    ap.add_argument("--only", nargs="+", choices=ALL_TESTS,
                    help="run only these tests (default: all)")
    ap.add_argument("--tariff", type=float, default=68.0, help="₦/kWh for cost figures")
    # savings projection (illustrative)
    ap.add_argument("--standby-w", type=float, help="assumed standby load cut (W)")
    ap.add_argument("--hours-cut", type=float, help="assumed hours/day power is cut")
    ap.add_argument("--baseline-kwh", type=float, help="measured baseline kWh/day (optional)")
    args = ap.parse_args()

    # expand globs
    paths = []
    for pat in args.capture:
        hits = glob.glob(pat)
        paths.extend(hits if hits else [pat])
    missing = [p for p in paths if not os.path.exists(p)]
    for p in missing:
        print(f"warning: capture not found: {p}", file=sys.stderr)

    results_dir = os.path.abspath(args.results_dir)
    common.ensure_dir(results_dir)
    buckets = common.read_capture(paths)

    tag_counts = {t: len(v) for t, v in buckets.items()}
    print(f"parsed capture(s): {paths}")
    print(f"tagged rows: {tag_counts}\n")

    want = set(args.only) if args.only else set(ALL_TESTS)
    metrics = {}

    if "accuracy" in want:
        metrics["accuracy"] = accuracy.run(buckets, results_dir)
    if "latency" in want:
        metrics["latency"] = latency.run(buckets, results_dir)
    if "relay" in want:
        metrics["relay"] = relay.run(buckets, results_dir)
    if "comms" in want:
        metrics["comms"] = comms.run(buckets, results_dir)
    if "selfpower" in want:
        metrics["selfpower"] = selfpower.run(buckets, results_dir)
    if "savings" in want:
        metrics["savings"] = savings.run(
            buckets, results_dir, standby_w=args.standby_w,
            hours_cut_per_day=args.hours_cut, baseline_kwh_per_day=args.baseline_kwh,
            tariff=args.tariff)
    if "survey" in want:
        metrics["survey"] = survey.run(buckets, results_dir, survey_path=args.survey)

    summary.run(metrics, results_dir)
    print(f"\nall artifacts written to {results_dir}")


if __name__ == "__main__":
    main()

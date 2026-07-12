"""Shared helpers for the HEMS evaluation pipeline: capture parsing, print-ready
greyscale figure style, table/figure writers, and the NO-DATA marker.

Integrity rule (see evaluation/README.md): nothing here fabricates data. A tag
with no rows yields an empty result and a "NO DATA — run test X" marker; it
never invents plausible numbers.
"""
import os
import sys

import matplotlib
matplotlib.use("Agg")          # headless — write PNGs, never open a window
import matplotlib.pyplot as plt
import pandas as pd

# Tags emitted by the firmware test mode (hems_test.h). Everything else in a
# capture ([pzem], [nilm], boot logs, …) is ignored.
KNOWN_TAGS = ["DATA", "LAT", "RLY", "ALRT", "COMM", "PWR"]

# The literal header row the firmware prints once for the #DATA stream; skip it.
_DATA_HEADER_MARK = "timestamp_iso"


def read_capture(paths):
    """Bucket capture lines by their leading #TAG.

    Accepts a path or list of paths (multiple test captures combine cleanly).
    Returns {tag: list[list[str]]} — each row is the comma-separated fields
    AFTER the tag. Missing files are skipped silently (the caller decides
    whether that's a NO-DATA condition).
    """
    if isinstance(paths, (str, os.PathLike)):
        paths = [paths]
    buckets = {t: [] for t in KNOWN_TAGS}
    for path in paths:
        if not path or not os.path.exists(path):
            continue
        with open(path, encoding="utf-8", errors="replace") as fh:
            for raw in fh:
                line = raw.strip()
                if not line.startswith("#") or "," not in line:
                    continue
                head, _, rest = line.partition(",")
                tag = head[1:]                       # strip leading '#'
                if tag not in buckets:
                    continue
                fields = rest.split(",")
                if tag == "DATA" and fields and fields[0] == _DATA_HEADER_MARK:
                    continue                         # the printed CSV header
                buckets[tag].append(fields)
    return buckets


def nodata(test_name, hint):
    """Emit the standard NO-DATA marker. Returns None so callers can `return
    nodata(...)` and continue."""
    print(f"NO DATA — {test_name}: {hint}")
    return None


def ensure_dir(path):
    os.makedirs(path, exist_ok=True)
    return path


def save_table(df, path):
    """Write a results table as CSV and echo it to the console."""
    ensure_dir(os.path.dirname(path))
    df.to_csv(path, index=False)
    print(df.to_string(index=False))
    print(f"  -> {path}")


def style():
    """Print-ready, greyscale-safe defaults. Figures must read in black & white,
    so we lean on greys + hatches + markers, never colour alone."""
    plt.rcParams.update({
        "figure.dpi": 150,
        "savefig.dpi": 150,
        "savefig.bbox": "tight",
        "font.size": 11,
        "axes.titlesize": 12,
        "axes.grid": True,
        "grid.color": "0.85",
        "grid.linewidth": 0.6,
        "axes.axisbelow": True,
        "axes.edgecolor": "0.2",
    })


# Greyscale fills + hatches for categorical bars (distinct without colour).
GREYS = ["0.75", "0.55", "0.35", "0.15", "0.65", "0.45"]
HATCHES = ["", "//", "..", "xx", "\\\\", "++"]


def save_fig(fig, path):
    ensure_dir(os.path.dirname(path))
    fig.savefig(path)
    plt.close(fig)
    print(f"  -> {path}")


def to_float(x, default=float("nan")):
    try:
        return float(x)
    except (TypeError, ValueError):
        return default

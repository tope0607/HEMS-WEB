"""Turn captured '[nilm] ...' serial lines into characterization rows.

Bench-characterisation helper: toggle ONE appliance in isolation ~10 times
while capturing the Serial Monitor output, then run this with that
appliance's label to append labelled (label, dP, dQ) rows to your training
CSV. Repeat per appliance.

  # capture the serial output to a file while toggling only the kettle, then:
  python tools/log_to_csv.py Kettle kettle.log >> my_characterization.csv
  # or pipe straight from a saved log / clipboard file:
  python tools/log_to_csv.py Soldering_Iron < iron.log >> my_characterization.csv

Every '[nilm] ON/OFF dP=..W dQ=..VAR' line becomes one row. ON and OFF both
count (the classifier uses |dP|,|dQ|), so ~10 toggles ≈ 20 samples. Start
the CSV with a header once:  echo "label,dP,dQ" > my_characterization.csv
"""
import re
import sys

LINE = re.compile(r"\[nilm\].*dP=([+-]?\d+)\s*W.*dQ=([+-]?\d+)\s*VAR")


def main(label, path=None):
    src = open(path) if path else sys.stdin
    n = 0
    for line in src:
        m = LINE.search(line)
        if m:
            dp, dq = m.group(1), m.group(2)
            print(f"{label},{dp},{dq}")
            n += 1
    if path:
        src.close()
    print(f"# {n} samples for '{label}'", file=sys.stderr)


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit("usage: python tools/log_to_csv.py <Label> [serial.log]  (reads stdin if no file)")
    main(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else None)

"""Live serial → characterisation CSV capture.

The better workflow: instead of copy-pasting the Serial Monitor into a log
file and running log_to_csv.py afterwards, this reads the ESP32's serial port
directly and appends a labelled (label, dP, dQ) row to your training CSV the
instant the firmware detects each ON/OFF event — with live on-screen feedback
so you can see every toggle register.

  # close the Arduino Serial Monitor first (only one program can hold the port)
  python tools/capture_serial.py Electric_iron --port COM5
  python tools/capture_serial.py Electric_kettle --port /dev/ttyUSB0

Then physically toggle THAT ONE appliance on/off ~10 times. Each toggle the
firmware prints as a '[nilm] ...' line becomes one row (ON and OFF both count,
the classifier uses |dP|,|dQ|), so ~10 toggles ≈ 20 samples. Ctrl-C to stop;
it prints the running total. Re-run per appliance — rows append, and the
'label,dP,dQ' header is written once automatically.

Requires pyserial:   pip install pyserial
List available ports:  python tools/capture_serial.py --list

Feed the finished CSV straight to the trainer:
  python train.py characterization.csv model.json
  python tools/export_model.py            # bake model.json → firmware header
"""
import argparse
import csv
import os
import re
import sys
import time

# Matches the firmware's line:  [nilm] ON  dP=+1980W dQ=+15VAR d=0.42 -> Electric_iron
LINE = re.compile(
    r"\[nilm\]\s*(ON|OFF)\s*dP=([+-]?\d+)\s*W\s*dQ=([+-]?\d+)\s*VAR"
    r"(?:\s*d=([\d.]+))?\s*(?:->\s*(\S+))?"
)


def list_ports():
    try:
        from serial.tools import list_ports
    except ImportError:
        sys.exit("pyserial not installed — run:  pip install pyserial")
    ports = list(list_ports.comports())
    if not ports:
        print("no serial ports found (is the ESP32 plugged in?)")
        return
    print("available serial ports:")
    for p in ports:
        print("  %-12s %s" % (p.device, p.description))


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("label", nargs="?", help="appliance name for these rows, e.g. Electric_iron")
    ap.add_argument("--port", help="serial port, e.g. COM5 or /dev/ttyUSB0")
    ap.add_argument("--baud", type=int, default=115200, help="baud rate (default 115200)")
    ap.add_argument("--out", default="characterization.csv", help="CSV to append to")
    ap.add_argument("--list", action="store_true", help="list serial ports and exit")
    args = ap.parse_args()

    if args.list:
        list_ports()
        return
    if not args.label or not args.port:
        ap.error("need both a label and --port (or use --list to find the port)")

    try:
        import serial
    except ImportError:
        sys.exit("pyserial not installed — run:  pip install pyserial")

    try:
        ser = serial.Serial(args.port, args.baud, timeout=1)
    except serial.SerialException as e:
        sys.exit("could not open %s: %s\n"
                 "(close the Arduino Serial Monitor — only one program can hold the port)"
                 % (args.port, e))

    new_file = not os.path.exists(args.out) or os.path.getsize(args.out) == 0
    out = open(args.out, "a", newline="")
    writer = csv.writer(out)
    if new_file:
        writer.writerow(["label", "dP", "dQ"])

    print("capturing '%s' from %s @ %d baud -> %s" % (args.label, args.port, args.baud, args.out))
    print("toggle the appliance on/off; Ctrl-C to stop\n")
    n = 0
    try:
        while True:
            raw = ser.readline()
            if not raw:
                continue
            text = raw.decode("utf-8", "replace").strip()
            m = LINE.search(text)
            if not m:
                continue
            edge, dp, dq, dist, decided = m.groups()
            writer.writerow([args.label, dp, dq])
            out.flush()
            n += 1
            note = (" (firmware guessed: %s)" % decided) if decided and decided != args.label else ""
            print("  #%-3d %-3s dP=%+5sW dQ=%+5sVAR%s" % (n, edge, dp, dq, note))
    except KeyboardInterrupt:
        pass
    finally:
        out.close()
        ser.close()
        print("\ncaptured %d samples for '%s' -> %s" % (n, args.label, args.out))
        if n < 6:
            print("that's thin — aim for ~20 (≈10 on/off toggles) per appliance for a stable fit")


if __name__ == "__main__":
    main()

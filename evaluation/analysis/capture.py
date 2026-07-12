"""Capture the ESP32 serial stream to a log file for the evaluation harness.

Unlike nilm/tools/capture_serial.py (which extracts only NILM rows), this saves
EVERY line verbatim — all the #DATA/#LAT/#RLY/#ALRT/#COMM/#PWR tag streams —
so one capture file can feed the whole analysis. Run it during a test session,
then point analyze.py at the file it writes.

  pip install pyserial
  python capture.py --list                       # find your port
  python capture.py --port COM5 --out ../logs/accuracy_kettle.log
  # ...run the test (type serial commands in another terminal or here)...
  Ctrl-C to stop.

It echoes lines live so you can watch the test progress, and (unless --quiet)
forwards anything you type back to the ESP32, so you can issue LOAD / RELAYTEST
/ ALRTTEST commands from the same window.
"""
import argparse
import sys
import threading
import time


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
        print(f"  {p.device:<12} {p.description}")


def _forward_stdin(ser):
    """Send typed lines to the ESP32 so you can issue test commands inline."""
    try:
        for line in sys.stdin:
            ser.write(line.encode("utf-8", "replace"))
    except Exception:
        pass


def main():
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--port", help="serial port, e.g. COM5 or /dev/ttyUSB0")
    ap.add_argument("--baud", type=int, default=115200)
    ap.add_argument("--out", help="log file to append the capture to")
    ap.add_argument("--list", action="store_true", help="list serial ports and exit")
    ap.add_argument("--quiet", action="store_true", help="do not forward stdin to the ESP32")
    args = ap.parse_args()

    if args.list:
        list_ports()
        return
    if not args.port or not args.out:
        ap.error("need --port and --out (or --list to find the port)")

    try:
        import serial
    except ImportError:
        sys.exit("pyserial not installed — run:  pip install pyserial")

    try:
        ser = serial.Serial(args.port, args.baud, timeout=1)
    except serial.SerialException as e:
        sys.exit(f"could not open {args.port}: {e}\n"
                 "(close the Arduino Serial Monitor — only one program can hold the port)")

    if not args.quiet:
        t = threading.Thread(target=_forward_stdin, args=(ser,), daemon=True)
        t.start()

    print(f"capturing {args.port} @ {args.baud} -> {args.out}   (Ctrl-C to stop)")
    n = 0
    with open(args.out, "a", encoding="utf-8") as out:
        out.write(f"# capture started {time.strftime('%Y-%m-%d %H:%M:%S')}\n")
        out.flush()
        try:
            while True:
                raw = ser.readline()
                if not raw:
                    continue
                text = raw.decode("utf-8", "replace").rstrip("\r\n")
                print(text)
                out.write(text + "\n")
                out.flush()
                n += 1
        except KeyboardInterrupt:
            pass
        finally:
            ser.close()
            print(f"\nsaved {n} lines to {args.out}")


if __name__ == "__main__":
    main()

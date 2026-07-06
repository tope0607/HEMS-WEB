#!/usr/bin/env bash
# Full parity check: Python reference vs the C++ port, same inputs.
# Run from the repo root. Requires: python3 (+numpy in nilm/.venv or system), g++.
set -euo pipefail

cd "$(dirname "$0")/../../../../.."   # repo root
PY="$PWD/nilm/.venv/bin/python"
[ -x "$PY" ] || PY=$(command -v python3)

echo "── 1/4 Python reference (train if needed, replay day_stream) ─────────"
(
  cd nilm
  [ -f characterization.csv ] || "$PY" simulator.py characterize
  [ -f model.json ] || "$PY" train.py
  [ -f day_stream.csv ] || "$PY" simulator.py day --hours 6
  "$PY" tools/dump_reference.py
  "$PY" tools/export_model.py
)

echo "── 2/4 compile C++ port (host) ────────────────────────────────────────"
BUILD=$(mktemp -d)
g++ -O2 -Wall -Wextra -I firmware/libraries/hems_nilm_cpp/src \
    firmware/libraries/hems_nilm_cpp/extras/parity/parity.cpp \
    firmware/libraries/hems_nilm_cpp/src/hems_nilm.cpp \
    -o "$BUILD/parity"

echo "── 3/4 run C++ over the same stream ───────────────────────────────────"
"$BUILD/parity" nilm/day_stream.csv > "$BUILD/cpp_output.txt"

echo "── 4/4 compare ────────────────────────────────────────────────────────"
$PY firmware/libraries/hems_nilm_cpp/extras/parity/compare_parity.py \
    nilm/reference.json "$BUILD/cpp_output.txt"

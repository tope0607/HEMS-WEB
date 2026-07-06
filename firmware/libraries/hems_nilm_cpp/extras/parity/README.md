# Parity test — C++ port vs Python reference

The port is only trustworthy if it reproduces the Python engine exactly:
same events (time, phase, ΔP, ΔQ, sign, label, distance) and the same
per-phase energy attribution over a full simulated day.

```bash
# from the repo root (needs python3+numpy and g++)
firmware/libraries/hems_nilm_cpp/extras/parity/run_parity.sh
```

What it does:

1. Runs the Python side in `nilm/`: characterisation → `train.py` →
   6 h simulated 3-phase day → `tools/dump_reference.py` (canonical event
   log + energy report) → `tools/export_model.py` (bakes the same model
   into `src/nilm_model.h`).
2. Compiles `parity.cpp` + `src/hems_nilm.cpp` with g++ on the host.
3. Replays the identical `day_stream.csv` through the C++ port.
4. `compare_parity.py` asserts: identical event count, per-event equality
   (label/sign/phase exact, numerics ≤1e-6), energy report ≤1e-6 Wh.

Last verified result:

```
processed 21600 samples, 115 events
PARITY OK: 115 events identical, energy report matches (<=1e-6 Wh)
```

The C++ engine deliberately uses `double` throughout — at 3 phases × 1 Hz
the FP cost on the ESP32 is negligible, and it makes the port numerically
equivalent to Python's float64, which is what allows this test to demand
1e-6 instead of hand-wavy tolerances.

Re-run whenever `nilm/` changes or the model is retrained.

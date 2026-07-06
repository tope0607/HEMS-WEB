# Connecting the NILM engine to the HEMS Firebase system

This document records how the NILM code (`nilm/`, delivered as a Python
engine) is wired into the ESP32 + Firebase system, what had to change to get
there, and the exact step-by-step to go from nothing to appliance labels on
the dashboard.

## 1 · What the NILM code was when it arrived (gap analysis)

The zip contained the **Python** engine (`event_detector.py`, `classifier.py`,
`attribution.py`, `pipeline.py`, `signal.py`), its simulator/trainer, and an
old ESP32 sketch (`esp32_hems_node.ino`). As sent, it could not connect to
this system:

| # | Gap | Why it blocked integration | Resolution |
|---|---|---|---|
| 1 | **No C++ port existed** — Python + numpy only | An ESP32 can't run Python; the HEMS architecture mandates on-device NILM | Ported to `firmware/libraries/hems_nilm_cpp` (double-precision, faithful line-for-line) |
| 2 | **MQTT + PC topology** — the engine ran on a computer fed by a broker | The capstone architecture is locked: no broker, no external server, Firebase only | Engine now runs *on* the ESP32; Firebase carries only results (label + events) |
| 3 | **Old sketch was a "dumb publisher"** — MQTT JSON, no Firebase, blocking reconnect loops, pin map that clashes with the contactor (GPIO 25) | Superseded by `firmware/hems_esp32` | Kept at `nilm/esp32/` as a **lab tool** for the characterisation campaign only |
| 4 | **No trained model in the zip** — no `model.json` / `characterization.csv` | The classifier is empty until a signature library exists | Toolchain reproduced; a demo model (simulator-trained, 10 classes) is baked in so everything runs; replace after the real bench campaign |
| 5 | **Cadence mismatch** — engine expects 1 Hz per-phase samples (settle window = 4 consecutive 1 s plateaus); HEMS firmware sensed at 5 s | Events would never be detected at 5 s | Firmware now senses at **1 Hz** and publishes to the cloud at 5 s / 60 s (free tier untouched) |
| 6 | **Per-phase vs totals** — engine classifies per phase with per-phase candidate lists; the firmware placeholder fed building totals | *A phase* is the unit of disaggregation; totals destroy the feature space | Firmware feeds per-phase (P, Q); per-phase candidate **bitmasks** baked from `config.json` |
| 7 | **No model path to the device** — `model.json` is runtime-loaded JSON | The ESP32 shouldn't parse/store JSON models | `nilm/tools/export_model.py` compiles model + config into `nilm_model.h` |
| 8 | **No confidence value** — classifier returns (label, distance); the UI contract shows "Kettle ON (94%)" | Display contract | Port adds `confidence = 1 − distance/τ` (clamped), used for display only |
| 9 | **No parity proof** — the port task requires the port ship with a parity test | Silent porting bugs corrupt classification invisibly | `extras/parity`: same 6 h day through both engines → **115/115 events identical, energy ≤1e-6 Wh** |

Two things needed **no** change, verified rather than assumed:

- **Q convention** — `signal.py` derives `Q = √(max(S²−P²,0))` as a positive
  magnitude (inductive assumption). The firmware computes exactly this, so
  training features and live features match by construction.
- **The algorithm itself** — detector thresholds, k-NN standardisation/τ
  rejection, attribution reconciliation are ported verbatim, not redesigned.

## 2 · How each aspect connects to the ESP32 (step by step)

```
bench characterisation ──► train.py ──► model.json ─┐
        (Python, lab)                               │ export_model.py
                                                    ▼
                                            nilm_model.h (baked)
                                                    │ compile
3× PZEM-004T ──1 Hz──► hems_esp32.ino ──► hems_nilm_cpp (on-device)
                              │                     │ events
                              │◄────────────────────┘
                              ▼
              RTDB /live.applianceLabel  +  Firestore events/
                              ▼
                        web dashboard
```

### Step 1 — Produce the signature library (PC, once per building)

1. `cd nilm && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt`
2. **With hardware** (the real campaign): wire ONE PZEM to a bench socket,
   flash the lab node `nilm/esp32/esp32_hems_node.ino` (its only job: stream
   1 Hz samples over MQTT to your laptop), run a broker + `python run.py
   --mqtt <host>`, then toggle each appliance in isolation ~10–20 times and
   record each ON/OFF step as a `label,dP,dQ` row in a CSV.
   **Without hardware** (demo/dev): `python simulator.py characterize`
   generates a synthetic `characterization.csv`.
3. `python train.py [your_characterization.csv]` → `model.json`
   (prints leave-one-out accuracy and a data-driven τ suggestion — sanity-
   check both before going further).
4. Set each appliance's `"phase"` in `config.json` to match the
   electrician's phase map — that alone defines the per-phase candidate
   sets. Update `background_w` from the observed overnight floor.

### Step 2 — Bake the model into the firmware (PC, seconds)

```bash
cd nilm && python tools/export_model.py
```

Writes `firmware/libraries/hems_nilm_cpp/src/nilm_model.h`: standardised
training set, μ/σ, k, τ, detector/attribution thresholds, per-phase class
bitmasks. **Re-run after every train.py.**

### Step 3 — Prove the port still matches Python (PC, one command)

```bash
firmware/libraries/hems_nilm_cpp/extras/parity/run_parity.sh
# expected: PARITY OK: … events identical, energy report matches (<=1e-6 Wh)
```

### Step 4 — Install the library where the Arduino IDE finds it

Copy `firmware/libraries/hems_nilm_cpp/` into `~/Arduino/libraries/`
(or symlink it). It has no dependencies of its own.

### Step 5 — Flash the production firmware

`firmware/hems_esp32/hems_esp32.ino` (see FIRMWARE_GUIDE.md for the full
bring-up). The NILM-relevant behaviour:

- Reads the three PZEMs at **1 Hz** — PZEM-1/2/3 map to config phases
  A/B/C. Wire each PZEM to the phase the electrician mapped.
- Derives per-phase Q and calls `nilm.processSample(t, p[3], q[3])` every
  second. Sensing and NILM keep running through WiFi outages.
- On each emitted event: `applianceLabel` becomes `"AC_HOD ON (92%)"`
  (or `"Unknown load ON"` when τ rejects it) and lands in RTDB `/live`
  on the next 5 s overwrite; an `events/` doc
  `{ts, type:"appliance", appliance, event, powerW}` goes to Firestore.
- Serial monitor logs every event with ΔP/ΔQ/distance for field debugging.

### Step 6 — See it in the web app (nothing to do)

The dashboard already consumes the contract: the label shows as the status
pill on the Appliance card, `events/` feed the timeline and the History →
Events table, and CSV export includes them.

## 3 · Free-tier & resource accounting after integration

- NILM adds **zero** Firebase traffic beyond the existing contract — events
  are the only new writes (a real building produces tens/day, not thousands).
- The 1 Hz sensing loop is local only; `/live` stays a 5 s overwrite.
- On-device cost: model table ~13 kB flash (const), per-phase state < 2 kB
  RAM, and a few hundred double ops/second — negligible beside TLS.
  Detection latency ≈ settle_window (4 s) after a switching step, matching
  the Python engine by definition.

## 4 · Retraining loop (when labels are wrong in the field)

1. Add/replace rows in the characterisation CSV (or re-run the campaign for
   the offending appliance, e.g. split `Fan_low` / `Fan_high`).
2. `train.py` → check LOO accuracy → `tools/export_model.py`.
3. `run_parity.sh` (still green?) → re-flash `hems_esp32`.
   The Python engine, the baked model, and the device can never drift apart
   silently: the header is generated, and parity is one command.

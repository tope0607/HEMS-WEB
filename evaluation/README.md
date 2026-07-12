# HEMS Objective 4 — test harness & analysis pipeline

Tooling for: *"integrate, test, and evaluate the developed system … to assess
its accuracy, reliability, and effectiveness in energy monitoring and control."*

Two parts:
- **`firmware_test_mode/`** — documentation for the instrumentation compiled
  into the firmware (`firmware/hems_esp32/hems_test.h`, enabled with
  `TEST_MODE=1`). Adds tagged Serial logging + bench-test routines **around**
  the production code without changing it.
- **`analysis/`** — a pandas/matplotlib CLI (`analyze.py`) that ingests a
  serial capture and writes Chapter-4 tables (`results/*.csv`) and figures
  (`results/*.png`).

## Honest testing constraints (these shape every output)

- **Bench-scale only.** Faculty-building distribution-board integration was not
  completed (deadline + all 230 V/415 V mains work needs a qualified
  electrician). Loads: **electric kettle, electric iron, soldering iron, laptop
  charger**.
- **Accuracy is a rated-value comparison.** There is no calibrated reference
  meter — % error is measured reading vs **manufacturer rated wattage**, never
  meter-vs-meter.
- **No fabricated data.** Every number traces to a logged reading or a labelled
  projection. Tests with no capture print `NO DATA — run test X` and show
  `not run` in the summary. Illustrative outputs (energy savings, uptime) are
  hard-labelled projections.

## Layout

```
evaluation/
  firmware_test_mode/README.md   instrumentation + serial command + tag reference
  analysis/                      analyze.py + per-test modules + capture.py
  logs/                          raw serial captures (gitignored)
  results/                       generated tables (CSV) + figures (PNG)
```

## One-time setup

```bash
cd evaluation/analysis
pip install -r requirements.txt          # pandas, matplotlib, numpy, pyserial
```

Then build the firmware with **`TEST_MODE=1`** (see
`firmware_test_mode/README.md`) and flash. Confirm the boot banner
`# ═══ HEMS TEST MODE ENABLED ═══` and that `[nilm] engine ready: N classes`
shows your trained model.

Capture a session (close the Arduino Serial Monitor first):

```bash
python capture.py --list                                   # find the port
python capture.py --port COM5 --out ../logs/session.log    # Ctrl-C to stop
```

You can run every test into **one** capture file and analyse it once, or use a
file per test — `analyze.py --capture` accepts several files/globs.

---

## Run order — one section per test

Each test: the load, the serial command, how long, and the analysis command.
Commands are typed into the same `capture.py` window (or the Serial Monitor).

### Test 1 · CSV telemetry (backbone)
Just capturing runs this — the firmware streams `#DATA` rows continuously.
Leave a load on for ~30 s so there are enough samples. Nothing to type.

### Test 2 · Accuracy (rated-value comparison)
For **each** load, in isolation:
1. `LOAD Electric_kettle 2000` (use the appliance's **nameplate** watts)
2. switch the load **on**, leave ~20–30 s
3. switch it **off**, then `LOAD off`
4. repeat for the iron, soldering iron, laptop charger (their rated W)

```bash
python analyze.py --capture ../logs/session.log --only accuracy
```
→ `results/accuracy.csv` (Load | Rated W | System reading W | % error) + `accuracy.png`.

### Test 3 · Latency (event → dashboard)
With NILM running and a **trained** appliance, toggle it on/off ~8–10 times,
pausing a few seconds between toggles so each event is distinct.

```bash
python analyze.py --capture ../logs/session.log --only latency
```
→ `latency_trials.csv`, `latency_summary.csv`, `latency.png`. Measures
detection→cloud-write-confirmed; the /live display adds up to the 5 s publish
interval by design.

### Test 4 · Relay / contactor switching
A load must sit downstream of the contactor (read-back is via PZEM current).
Then:
```
RELAYTEST 20
```
Wait ~1 minute for the 20 cycles (`#RLY,done,20`).
```bash
python analyze.py --capture ../logs/session.log --only relay
```
→ `relay_trials.csv`, `relay_summary.csv`, `relay.png` (e.g. 19/20 = 95%).

### Test 5 · High-load / overload-trip logic (reduced threshold)
Verifies the **real** overload auto-trip (production feature, default off) at a
bench-safe threshold. With the kettle wired through the contactor:
```
ALRTTEST 1500
```
Switch on the kettle (+iron if needed) to cross 1500 W and hold it. After the
`OVERLOAD_TRIP_DEBOUNCE_MS` window the contactor cuts (`#ALRT,trip`). Then
`ALRTTEST off`. The `#ALRT` markers are analysed as part of the capture (no
separate command); this is labelled a *reduced-threshold functional test*, not
a test at the production 5 kW/10.8 kW setting.

### Test 6 · Communication reliability
Uploads log automatically as `#COMM` while capturing. To measure reconnect
time, **pull Wi-Fi** (disable the AP or move out of range) for ~10 s, then
restore it. Do this once or twice during the session.
```bash
python analyze.py --capture ../logs/session.log --only comms
```
→ `comms_summary.csv` (% success) + `comms_reconnect.csv` (reconnect time).

### Test 7 · System self-power
If you can meter the controller board's own supply, feed readings in:
```
PWR 5.02 0.28
```
Otherwise the analysis emits a **datasheet estimate** table (clearly labelled).
```bash
python analyze.py --capture ../logs/session.log --only selfpower
```

### Test 8 · Energy-savings projection (illustrative) & usability survey
Savings is a **projection** from assumptions you supply — never a measured
building result:
```bash
python analyze.py --capture ../logs/session.log --only savings \
    --standby-w 50 --hours-cut 10
```
Usability: put Likert 1–5 responses in `logs/survey.csv` with columns
`ease_of_use, nilm_usefulness, remote_control_satisfaction, energy_awareness`
(one row per respondent), then:
```bash
python analyze.py --capture ../logs/session.log --only survey --survey ../logs/survey.csv
```
Absent `survey.csv` → skipped with a NO-DATA notice (never invented).

---

## Everything at once + the summary table

```bash
python analyze.py --capture ../logs/session.log \
    --survey ../logs/survey.csv --standby-w 50 --hours-cut 10
```
Writes all per-test artifacts plus `results/summary.csv` — one overall table
(accuracy, latency, switching reliability, comms success, self-power,
usability). Any test without data shows `not run`.

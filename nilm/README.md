# HEMS NILM Engine

Non-Intrusive Load Monitoring for the Mechatronics department: one
measurement point per phase (3x PZEM-004T), disaggregated into appliances by
classifying their switching signatures. Runs end-to-end **without hardware**
against a simulator, then swaps to live PZEM data through the same code path.

## How it works (each block -> file)

| Stage | File | What it does |
|---|---|---|
| Sample helpers | `nilm/signal.py` | Derive S=V·I and Q=√(S²−P²) (PZEM gives no Q) |
| Event detection | `nilm/event_detector.py` | Per-phase steady-state tracker; emits clean (ΔP, ΔQ) steps. `dp_min_w` is the detectable/background line |
| Classification | `nilm/classifier.py` | k-NN on (\|ΔP\|, \|ΔQ\|) with **feature standardisation**, inverse-distance voting, a **rejection threshold** (unknown loads), and **per-phase candidate restriction** |
| Attribution | `nilm/attribution.py` | Per-phase ON/OFF state machine, per-sample energy accrual, **residual reconciliation**, background-aware missed-edge correction, quiescent hard-resync |
| Orchestration | `nilm/pipeline.py` | Wires detector → classifier → attributor per phase |
| Config | `config.json` | Thresholds, appliance specs, per-phase background; single source of truth |

The feature vector is **(ΔP, ΔQ)** only — both are additive across loads, so
they are an appliance's own real/reactive power. ΔPF is deliberately *not* a
feature (power factor is a ratio, not additive, so its step depends on what
else is running).

## Quickstart (no hardware needed)

```bash
pip install -r requirements.txt

python simulator.py characterize     # synthetic stand-in for bench characterisation -> characterization.csv
python train.py                      # build the signature library (scaling, tau, LOO accuracy) -> model.json
python simulator.py day --hours 6    # synthesise a 3-phase working day -> day_stream.csv + ground_truth.json
python run.py                        # disaggregate + score against ground truth
python run.py --events               # also print the per-event log
```

Typical scorecard (~89–90% of measured energy attributed to named appliances;
major loads 98–99%; the untrained kettle correctly flagged `unknown`; the
sub-threshold lighting/chargers honestly pooled in `background`):

```
Phase A   (measured total ~4380 Wh)
  AC_HOD            3580 true   3517 est
  Fan_HOD            322         320
  Fridge_HOD         295         298
Phase B
  Desktop_HOD        672         667
  Fan_Admin2/Fan_SR  530         506
  [unknown]                       74   <- untrained kettle, rejected not misclassified
...
Named-appliance energy attributed: ~89%
```

## Going live with real PZEMs

The simulator produces exactly the sample format the ESP32 publishes, so only
the data source changes:

1. Flash `esp32/esp32_hems_node.ino` (set WiFi/MQTT, fit the external antenna
   for the metal DB). It publishes 1 Hz JSON to `hems/samples`.
2. Run a broker (e.g. `mosquitto`), then `python run.py --mqtt <broker-host>`.
3. **Characterisation:** instead of `simulator.py characterize`, record real
   deltas — toggle each appliance in isolation on one PZEM and log the (label,
   ΔP, ΔQ) of each on/off into a CSV with the same columns, then `python
   train.py your_characterization.csv`. The appliance signature is independent
   of phase, so characterise each type **once**; the per-phase appliance lists
   in `config.json` route which loads each phase's pipeline considers.

## Two things to set with your data

- **State granularity (open decision):** fans appear here as on/off at one
  speed. If you want to resolve fan speeds or AC compressor stages, label each
  state as its own class (`Fan_low`, `Fan_high`) during characterisation. This
  is the one choice that affects how you collect data — decide before the
  campaign.
- **Phase map:** once the electrician confirms which office/circuit is on which
  phase, set each appliance's `"phase"` in `config.json`. That alone tunes the
  per-phase candidate sets.

## Tuning knobs (`config.json`)

- `event_detector.dp_min_w` — detection floor (W). Raise to ignore more small
  loads, lower to catch smaller ones (at the cost of more false steps).
- `classifier.tau` — rejection distance (standardised units). Lower = stricter
  (more `unknown`); `train.py` prints a data-driven suggestion.
- `attribution.over_attribution_tol_w` / `background_w` — reconciliation
  sensitivity and the per-phase background floor estimate (set from your
  observed minimum/overnight load).

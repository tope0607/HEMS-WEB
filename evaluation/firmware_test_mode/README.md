# Firmware test mode — instrumentation reference

The evaluation instrumentation is **`firmware/hems_esp32/hems_test.h`**, wired
into the sketch with a handful of one-line, guarded hook calls. It is inert
unless you build with `TEST_MODE=1`, so the production firmware is unchanged.

> **Why the header lives in the sketch folder, not here.** Arduino IDE copies
> the sketch directory to a temporary build dir before compiling, so a
> `#include "../../evaluation/…"` reaching outside the sketch tree does not
> survive the build. The instrumentation also needs to sit in the sketch's own
> translation unit (it reads the same globals as the `.ino`). So, exactly like
> `build_opt.h`, it must be next to `hems_esp32.ino`. This folder is the
> documentation + the Python harness; the compiled header is
> `firmware/hems_esp32/hems_test.h`.

## Enabling test mode

Pick one:

- Edit `firmware/hems_esp32/hems_test.h`: `#define TEST_MODE 0` → `1`, or
- Add a line to `firmware/hems_esp32/build_opt.h`: `-DTEST_MODE=1`

Re-compile and flash. On boot the Serial Monitor prints
`# ═══ HEMS TEST MODE ENABLED ═══`, the `#DATA` CSV header, and the command
list. **Set it back to 0 for the production build.**

The production metering / NILM / Firebase logic is untouched either way — every
hook compiles to nothing when `TEST_MODE 0`.

## Serial commands (type them into the Serial Monitor or `capture.py`)

| Command | Effect |
|---|---|
| `LOAD <name> <ratedW>` | tag the following telemetry rows with the load under test, e.g. `LOAD Electric_kettle 2000` |
| `LOAD off` | clear the tag |
| `RELAYTEST [N] [ms]` | cycle the contactor N times (default 20) at `ms` settle interval (default 3000) |
| `ALRTTEST <W>` | arm the overload-trip test at reduced threshold W (e.g. `ALRTTEST 1500`) |
| `ALRTTEST off` | disarm the overload-trip test |
| `PWR <V> <A>` | log a measured controller-supply reading |
| `HELP` | reprint the command list |

## Tag reference (what the Python side parses)

Every test line is greppable by a leading `#TAG`. Non-tag lines (`[pzem]`,
`[nilm]`, boot logs) are ignored by the analysis.

```
#DATA,timestamp_iso,phase,voltage_v,current_a,power_w,energy_wh,pf,load_label,rated_w
#LAT,detect,<id>,<dP_W>                 # id = millis() at ΔP detection
#LAT,confirm,<id>,<confirm_ms>          # same id, echoed when the write confirms
#RLY,start,<N>,<intervalMs>
#RLY,<trial>,<commanded>,<confirmed>,<result>   # result = OK | MISMATCH
#RLY,done,<N>
#ALRT,config,<thresholdW>               # reduced-threshold test armed
#ALRT,cross,<ms>,<W>                    # load crossed the threshold
#ALRT,alert,<ms>,<W>                    # alert raised
#ALRT,trip,<ms>,<W>                     # contactor cut after the debounce
#COMM,attempt,<uid>,<ms>                # every Firebase upload started
#COMM,result,<uid>,<ok|fail>,<ms>       # every upload's outcome
#COMM,wifi,<up|down>,<ms>               # Wi-Fi transition (drop test)
#PWR,measured,<V>,<A>,<W>
```

## Overload auto-trip (production feature, default OFF)

Test 5 exercises a **real** production capability: autonomous overload
protection. In `config.h`:

```c
#define OVERLOAD_TRIP_ENABLED      0        // 1 = arm it in production
#define OVERLOAD_TRIP_W            10800.0f // trip threshold (W)
#define OVERLOAD_TRIP_DEBOUNCE_MS  5000UL   // sustained overload before tripping
```

It is **disabled by default** — automatically cutting the building is a
deliberate choice. The `ALRTTEST <W>` command lowers the threshold at runtime
so you can verify the debounce→trip logic with a kettle+iron at bench-safe
wattage **without** changing the production threshold. The `#ALRT` markers time
the escalation; analysis reports it as a *reduced-threshold functional test*,
never as a test at the production setting.

## Capturing

Close the Arduino Serial Monitor (one program per port), then:

```bash
cd evaluation/analysis
pip install pyserial
python capture.py --list                                  # find the port
python capture.py --port COM5 --out ../logs/session.log   # Ctrl-C to stop
```

`capture.py` saves every line and forwards what you type, so you can issue the
serial commands from the same window.

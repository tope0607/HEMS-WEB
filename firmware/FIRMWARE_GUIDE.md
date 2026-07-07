# HEMS ESP32 Firmware Guide

Sketch: `firmware/hems_esp32/hems_esp32.ino` + `config.h` + `build_opt.h`.
Target hardware is an **ESP32-WROOM-32UE** (4 MB flash, no PSRAM). All
processing happens on this one chip — there is no other computer in the
system.

`build_opt.h`, in the same folder as the `.ino`, is not optional: it forces
on the PZEM library's SoftwareSerial support for PZEM-3 (see §8 for why a
plain `#define` in the sketch can't do this itself). Arduino IDE picks it up
automatically as long as it stays next to `hems_esp32.ino` — no setup step
needed beyond keeping the file where it is.

## 1 · Board setup (Arduino IDE)

1. Arduino IDE ≥ 2.x → *Settings → Additional boards manager URLs*:
   `https://espressif.github.io/arduino-esp32/package_esp32_index.json`
2. Boards Manager → install **esp32 by Espressif Systems** (core **3.x**).
3. Select board **ESP32 Dev Module**, and set:
   - Flash Size: 4MB · Partition Scheme: **Default 4MB with spiffs**
   - CPU Frequency: 240 MHz · Upload speed 921600 (drop to 115200 if flaky)

## 2 · Libraries (Library Manager unless noted)

| Library | Author | Tested-against version | Purpose |
|---|---|---|---|
| **FirebaseClient** | Mobizt | ≥ 1.4.x | Auth, RTDB (SSE stream), Firestore |
| **PZEM004Tv30** | Jakub Mandula | ≥ 1.1.2 | PZEM-004T v3.0 Modbus reads |
| **EspSoftwareSerial** | Dirk Kaar | ≥ 8.1 | 3rd PZEM port |
| **hems_nilm_cpp** | this repo: `firmware/libraries/hems_nilm_cpp` | 1.0.0 | on-device appliance detection |

`hems_nilm_cpp` is a **local library that lives in this repository** — the
C++ port of the Python engine in `nilm/`, shipped with its parity test
(`extras/parity`, last result: 115/115 events identical to Python, energy
≤1e-6 Wh). Copy (or symlink) the folder into `~/Arduino/libraries/` so
`#include <hems_nilm.h>` resolves. The signature model is compiled in from
`src/nilm_model.h`; regenerate it with `nilm/tools/export_model.py` after
every retraining (see `docs/NILM_INTEGRATION.md` for the full workflow).
The sketch still compiles without the library (labels read "NILM
unavailable") so sensing and Firebase can be brought up first.

`// TODO: verify` markers in the sketch flag every API detail that must be
checked against your exact library versions (FirebaseClient's `Values` API and
loop calls, the PZEM SoftwareSerial constructor guard, onDisconnect
availability). Resolve them at first compile rather than trusting the
comment. The NILM API and Q-convention markers are gone: both are pinned by
the in-repo library and its parity test.

## 3 · Wiring & pin map

Point-to-point — **one PZEM per serial port. No shared TTL bus.** Each
PZEM-004T v3.0 TTL side: 5 V, GND, RX, TX (opto-isolated; power the TTL side
from 5 V, logic levels are ESP32-safe in this configuration — confirm your
PZEM board revision).

| Signal | ESP32 pin | Notes |
|---|---|---|
| PZEM-1 TX → | **GPIO 26** (RX) | UART1 — remapped; UART1's default pins clash with flash |
| PZEM-1 RX ← | **GPIO 27** (TX) | |
| PZEM-2 TX → | **GPIO 16** (RX) | UART2 |
| PZEM-2 RX ← | **GPIO 17** (TX) | |
| PZEM-3 TX → | **GPIO 18** (RX) | EspSoftwareSerial @9600 — fine at this baud |
| PZEM-3 RX ← | **GPIO 19** (TX) | |
| Contactor driver | **GPIO 25** | via opto/transistor relay module → contactor coil |
| UART0 (USB) | GPIO 1/3 | keep free for flashing + Serial monitor |

Why these pins: they avoid the boot-strap pins (0, 2, 5, 12, 15), the
SPI-flash pins (6–11), and the input-only pins (34–39). GPIO 25 idles LOW at
boot, so an active-HIGH relay stays de-energised during reset — set
`CONTACTOR_ACTIVE_HIGH` in `config.h` to match your relay board either way.

**Mains side:** each PZEM's voltage terminals go to one phase + neutral; each
current transformer clips around that phase's conductor only. The contactor's
coil circuit must be driven through a proper relay/driver module — never from
a GPIO directly. Mains wiring belongs to someone qualified.

## 4 · Firebase device credentials

The ESP32 signs in as the **device account** (email/password) created by the
seed script — the only identity whose token carries `role: "device"`, which is
what the security rules check for `/live`, `history/`, `events/` writes.

1. Run the seed script (see repo root README / `scripts/seed.mjs`).
2. In `config.h` fill in:
   - `FIREBASE_API_KEY` — console → Project settings → General → Web API key
   - `FIREBASE_DATABASE_URL` — console → Realtime Database URL
   - `FIREBASE_PROJECT_ID` — the plain project id
   - `DEVICE_EMAIL` / `DEVICE_PASSWORD` — whatever you seeded
3. WiFi SSID/password, tariff, capacity, thresholds — same file.

## 5 · Bring-up sequence

1. **Dry run, no mains:** flash with only WiFi + Firebase configured. Serial
   monitor @115200 should show WiFi connect, `[fb]` auth success, and 5 s
   cycles with zeroed phases (PZEMs absent → NaN → zeros, `ok=false`).
2. **Web checkpoint:** the dashboard's connection pill goes LIVE and `/live`
   updates every 5 s (all zeros).
3. **One PZEM on a bench socket:** confirm L1 shows plausible V/A/W/PF, then
   add the other two.
4. **Contactor:** from an admin login, hold the toggle — relay must click,
   `/live/contactorState` confirms, the card leaves PENDING. Pull the ESP32's
   power and confirm the UI shows OFFLINE (stale heartbeat) and the control
   card disables.
5. **NILM:** run the characterisation → `train.py` → `export_model.py`
   pipeline (docs/NILM_INTEGRATION.md), copy `firmware/libraries/
   hems_nilm_cpp` into `~/Arduino/libraries/`, re-flash, toggle a trained
   appliance and watch the Serial `[nilm]` log, `applianceLabel`, and the
   `events/` doc appear. Untrained loads must read "Unknown load", not a
   wrong appliance — that's the rejection threshold working.
6. **Soak:** leave it for a day; check Firestore usage stays ≈1,440 history
   writes + a handful of events (Spark budget is 20k/day).

## 6 · Behaviour notes

- **deviceOnline / offline detection.** The REST/SSE client library cannot
  register a true RTDB `onDisconnect()` handler, so the device writes
  `deviceOnline: true` + `lastUpdate` every cycle and the web app treats a
  heartbeat older than 20 s as offline. Same outcome, no Blaze features.
- **Daily kWh** = Σ PZEM lifetime counters − midnight baseline (stored in NVS,
  survives reboots; rebases automatically if a PZEM counter is reset). Reset
  time is local midnight (`TZ_OFFSET_SECONDS`, Lagos = UTC+1).
- **High load**: flag has 5 % hysteresis (9 600 W on / 9 120 W off by
  default); `events/` docs are debounced to ≥ 60 s apart.
- **WiFi loss**: sensing, NILM, kWh accounting, high-load logic and the
  contactor all keep running; FirebaseClient re-authenticates and the SSE
  stream resumes when the network returns. Nothing in `loop()` blocks.
- **Reboot safety**: last confirmed contactor state is restored from NVS
  *before* WiFi comes up, so a power blink doesn't drop the building.

## 7 · RAM headroom

Two TLS sessions (write client + stream client) cost ≈ 45–50 kB each; with
WiFi, both serial buffers and the Firebase stack expect **~120–170 kB free
heap** in steady state (from ~320 kB total DRAM), logged every 30 s:

```
[heap] free=142312 minFree=118940
```

Keep an eye on `minFree`. If it trends under ~60 kB: check for String churn,
shrink the events payloads, or lower the SSL RX buffer
(`sslWrite.setBufferSizes(4096, 1024)` — TODO: verify availability on your
WiFiClientSecure) before anything else. The NILM model's footprint comes on
top of this — budget it from the port task's parity report.

## 8 · Troubleshooting

| Symptom | Likely cause |
|---|---|
| `[fb] auth error 400` | wrong API key, or email/password auth not enabled |
| Auth OK but `[fb] live error 400` (writes fail, login works) | `FIREBASE_DATABASE_URL` malformed for FirebaseClient, which wants the bare host. The sketch now strips any `https://` and trailing `/` automatically, but if you're on an older build, set it to just `<project>-default-rtdb.<region>.firebasedatabase.app` — no scheme, no trailing slash. (Auth is unaffected because it hits a fixed Google endpoint, not this URL — which is why login succeeds while every RTDB op 400s.) |
| PERMISSION_DENIED on writes | device account missing the `role: device` claim — re-run the seed script, then power-cycle (forces re-auth) |
| NaN on one phase | that PZEM's wiring (TX/RX swapped) or no mains on its voltage terminals |
| Stream connects, no commands | admin write blocked by rules (check the web console), or `/control/contactor` path typo |
| Reboots under load | brown-out — give the relay module its own 5 V supply, common GND |
| `'UserAuth' does not name a type`, `'RealtimeDatabase' does not name a type`, `'Firestore' has not been declared`, or similar for every FirebaseClient symbol | FirebaseClient gates its whole API behind feature macros. `#define ENABLE_USER_AUTH`, `#define ENABLE_DATABASE`, `#define ENABLE_FIRESTORE` must appear **before** `#include <FirebaseClient.h>` — already fixed in the checked-in sketch, but if you copy code out of it into a new file, bring these three lines along |
| Linker error `undefined reference to 'PZEM004Tv30::PZEM004Tv30(...SoftwareSerial...)'`, **or** compile error `no matching function for call to 'PZEM004Tv30::PZEM004Tv30(SoftwareSerial&)'` | `PZEM004Tv30.h` only declares its `SoftwareSerial&`/`Stream&` constructors inside `#if defined(PZEM004_SOFTSERIAL)`, auto-enabled by the library for AVR/ESP8266 only — never ESP32. A `#define` in the `.ino` reaches only the sketch's own translation unit, not the library's separately-compiled `.cpp`, so the two disagree (one error if only the sketch defines it, the other if neither does). Fixed via `firmware/hems_esp32/build_opt.h`, which injects `-DPZEM004_SOFTSERIAL` into every file the build compiles, sketch and libraries alike — confirm that file is present next to the `.ino` (Arduino IDE picks it up automatically; no setup step needed beyond having it in the folder) |

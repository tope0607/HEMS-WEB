#pragma once

/* ═══════════════════════════════════════════════════════════════════════════
   HEMS ESP32 configuration — fill in the four credential blocks, check the
   pin map against your wiring, flash. Everything tunable lives here.
   ═══════════════════════════════════════════════════════════════════════ */

/* ── WiFi ─────────────────────────────────────────────────────────────── */
#define WIFI_SSID       "YOUR_WIFI_SSID"
#define WIFI_PASSWORD   "YOUR_WIFI_PASSWORD"

/* ── Firebase project ─────────────────────────────────────────────────────
   Web API key: console → Project settings → General.
   DATABASE_URL: console → Realtime Database. Either form works — the sketch
                 strips any scheme/trailing slash (FirebaseClient wants the
                 bare host). Regional DBs look like
                 <project>-default-rtdb.<region>.firebasedatabase.app.
   PROJECT_ID:   the plain project id, e.g. "hems-web-1a2b3".              */
#define FIREBASE_API_KEY     "YOUR_WEB_API_KEY"
#define FIREBASE_DATABASE_URL "YOUR_PROJECT-default-rtdb.YOUR_REGION.firebasedatabase.app"
#define FIREBASE_PROJECT_ID  "YOUR_PROJECT_ID"

/* ── Device account (created by scripts/seed.mjs — role claim: "device").
   This account is the ONLY identity allowed to write /live, history/,
   events/ by the security rules.                                          */
#define DEVICE_EMAIL    "device@hems.local"
#define DEVICE_PASSWORD "device-hems-2026"

/* ── Energy accounting ────────────────────────────────────────────────── */
#define TARIFF_NAIRA_PER_KWH 68.0f   // must match the web app's display tariff
#define CAPACITY_W           12000.0f // building capacity (gauge 100%)
#define HIGH_LOAD_W          9600.0f  // highLoad threshold (0.8 × capacity)
#define HIGH_LOAD_CLEAR_W    9120.0f  // 5% hysteresis so the flag doesn't flap

/* ── Overload auto-trip (autonomous protection, default OFF) ────────────────
   Independent escalation ABOVE the high-load alert: if total load stays over
   OVERLOAD_TRIP_W for OVERLOAD_TRIP_DEBOUNCE_MS, the contactor is cut
   (reason "overload"). Default disabled — automatically cutting the building
   is a deliberate choice; enable it and pick a threshold that suits the
   installation. The evaluation harness (TEST_MODE) can lower the threshold at
   runtime to verify the trip logic at bench-safe wattage without touching
   this production value. These are optional — the sketch falls back to these
   same defaults via #ifndef if your config.h predates them. */
#define OVERLOAD_TRIP_ENABLED      0        // 1 = arm autonomous overload cutoff
#define OVERLOAD_TRIP_W            10800.0f // trip threshold (0.9 × capacity, above the alert)
#define OVERLOAD_TRIP_DEBOUNCE_MS  5000UL   // sustained overload before tripping

/* Lagos is UTC+1, no DST. Daily kWh resets at local midnight. */
#define TZ_OFFSET_SECONDS    3600L

/* ── Cadence (ms) ─────────────────────────────────────────────────────────
   The NILM event detector is trained on 1 Hz plateaus (settle_window
   consecutive 1 s samples), so sensing runs at 1 Hz; the cloud only sees
   the 5 s /live overwrite and the 60 s history doc (free-tier discipline). */
#define SAMPLE_INTERVAL_MS      1000UL   // PZEM sweep + NILM feed (1 Hz)
#define LIVE_PUBLISH_MS         5000UL   // RTDB /live overwrite
#define HISTORY_INTERVAL_MS    60000UL   // one downsampled Firestore doc
#define HIGH_LOAD_DEBOUNCE_MS  60000UL   // min spacing between high_load events
#define HEAP_LOG_INTERVAL_MS   30000UL   // free-heap watermark to Serial

/* ── Pin map (ESP32-WROOM-32UE) ────────────────────────────────────────────
   Point-to-point UARTs — one PZEM per port, no shared TTL bus.
   RX pin listed = ESP32 side (connects to the PZEM's TX).

   Safe choices: avoids strap pins (0,2,5,12,15), flash pins (6–11),
   input-only pins (34–39), and UART0 (USB logging).                       */
#define PZEM1_RX 26   // UART1, remapped (default UART1 pins clash with flash)
#define PZEM1_TX 27
#define PZEM2_RX 16   // UART2 default-ish pins
#define PZEM2_TX 17
#define PZEM3_RX 14   // EspSoftwareSerial (avoid 32/33 — crystal-tied on some boards)
#define PZEM3_TX 13

// Relay IN pin. Must be a FREE GPIO — never share it with the RTC's I2C bus
// (21 SDA / 22 SCL) or a PZEM UART, or the contactor won't switch. 23 and 25
// are both safe (free, not strap pins, idle LOW at boot).
#define CONTACTOR_PIN          23
#define CONTACTOR_ACTIVE_HIGH  1   // 1: HIGH energises the relay; 0: LOW energises (active-low boards)

/* ── NILM phase mapping ────────────────────────────────────────────────────
   nilm/config.json declares the phases in order (e.g. ["A","B","C"]) and
   pins every appliance to one of them. The firmware feeds the engine in
   that same order: PZEM-1 → index 0 (A), PZEM-2 → index 1 (B),
   PZEM-3 → index 2 (C). Wire each PZEM to the mains phase the electrician
   mapped, or reorder here if the field wiring ends up different.           */

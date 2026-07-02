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
   DATABASE_URL: console → Realtime Database (include https://).
   PROJECT_ID:   the plain project id, e.g. "hems-web-1a2b3".              */
#define FIREBASE_API_KEY     "YOUR_WEB_API_KEY"
#define FIREBASE_DATABASE_URL "https://YOUR_PROJECT-default-rtdb.firebaseio.com/"
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

/* Lagos is UTC+1, no DST. Daily kWh resets at local midnight. */
#define TZ_OFFSET_SECONDS    3600L

/* ── Cadence (ms) ─────────────────────────────────────────────────────── */
#define POLL_INTERVAL_MS        5000UL   // PZEM sweep + /live overwrite
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
#define PZEM3_RX 18   // EspSoftwareSerial
#define PZEM3_TX 19

#define CONTACTOR_PIN          25
#define CONTACTOR_ACTIVE_HIGH  1   // 1: HIGH energises the relay coil driver

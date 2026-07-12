/* ═══════════════════════════════════════════════════════════════════════════
   HEMS ESP32 firmware — three-phase sensing → Firebase → contactor control
   Target: ESP32-WROOM-32UE (Arduino core 3.x), no external server.

   Duties, all non-blocking (no delay() anywhere):
     • poll 3× PZEM-004T at 1 Hz over point-to-point UARTs (the NILM
       detector is trained on 1 Hz plateaus)
     • per-phase Q = sqrt(max(S²−P², 0)) (inductive convention — verified
       identical to nilm/nilm/signal.py), daily kWh (PZEM cumulative
       counters − midnight baseline), ₦ cost
     • feed per-phase (P, Q) into hems_nilm_cpp → appliance label + events
     • OVERWRITE RTDB /live every 5 s (free-tier: RTDB, not Firestore)
     • one downsampled Firestore history doc every 60 s
     • stream /control/contactor, actuate relay, confirm into /live
     • high-load flag with hysteresis + debounced (≥60 s) events doc
     • WiFi-loss resilient: sensing continues, Firebase reconnects itself

   Libraries (see FIRMWARE_GUIDE.md for exact versions):
     FirebaseClient (mobizt), PZEM004Tv30 (mandulaj), EspSoftwareSerial,
     hems_nilm_cpp (local library from the NILM port task — REQUIRED for
     appliance labels; sketch still compiles without it for bring-up).
   ═══════════════════════════════════════════════════════════════════════ */

#include <Arduino.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <Preferences.h>
#include <time.h>

#include "config.h"

/* Overload auto-trip defaults — provided here via #ifndef so a config.h that
   predates this feature still compiles. Override in config.h. Default OFF. */
#ifndef OVERLOAD_TRIP_ENABLED
#define OVERLOAD_TRIP_ENABLED 0
#endif
#ifndef OVERLOAD_TRIP_W
#define OVERLOAD_TRIP_W 10800.0f
#endif
#ifndef OVERLOAD_TRIP_DEBOUNCE_MS
#define OVERLOAD_TRIP_DEBOUNCE_MS 5000UL
#endif

/* Evaluation harness (Objective 4). Inert unless built with TEST_MODE=1;
   production builds compile every hook below to nothing. See
   evaluation/README.md. Included early so fbCallback() can log write results. */
#include "hems_test.h"

/* Bench bring-up: 1 → print each phase's raw PZEM read (v/i/p + ok flag)
   every second. ok=0 means the PZEM didn't respond (NaN); ok=1 with v≈230
   means it's alive. Set to 0 once sensing is confirmed. Defined here (not
   config.h) so it doesn't collide with your local credentials file. */
#ifndef DEBUG_PZEM
#define DEBUG_PZEM 1
#endif

/* ── DS3231 real-time clock (optional) ──────────────────────────────────────
   The device gets time from NTP over WiFi; the DS3231 keeps accurate time
   when WiFi/NTP is unavailable so history/event timestamps stay correct
   offline. Install "RTClib" (Adafruit) via Library Manager. The RTC is I2C:
   wire SDA→GPIO21, SCL→GPIO22, VCC→3V3, GND→GND (override below if needed).
   The sketch still compiles and runs on NTP alone if RTClib isn't installed. */
#if __has_include(<RTClib.h>)
  #include <Wire.h>
  #include <RTClib.h>
  #define HAS_RTC 1
#else
  #define HAS_RTC 0
  #warning "RTClib not installed - DS3231 disabled, using NTP time only"
#endif
#ifndef RTC_SDA
#define RTC_SDA 21
#endif
#ifndef RTC_SCL
#define RTC_SCL 22
#endif

/* PZEM-3 rides EspSoftwareSerial. PZEM004Tv30's SoftwareSerial/Stream
   constructors only exist when PZEM004_SOFTSERIAL is defined — and the
   library auto-enables that only for AVR/ESP8266, never ESP32. A #define
   here would only reach this sketch's own translation unit, not the
   library's separately-compiled .cpp, so the two would disagree (declared
   here, never implemented there). The fix lives in build_opt.h, next to
   this .ino: it injects -DPZEM004_SOFTSERIAL into every file the build
   compiles — sketch and libraries alike — so both sides agree. */
#include <SoftwareSerial.h>
#include <PZEM004Tv30.h>

/* FirebaseClient (mobizt) gates its entire API behind these feature macros —
   they MUST be defined before the header is included, or UserAuth,
   RealtimeDatabase, Firestore::Documents, Values, Document<>, etc. simply
   don't exist and every use of them fails to compile with "does not name a
   type". Verified against the library's own examples (App/AppInitialization,
   RealtimeDatabase/Set, RealtimeDatabase/Stream, FirestoreDatabase/Documents/
   CreateDocument). */
#define ENABLE_USER_AUTH
#define ENABLE_DATABASE
#define ENABLE_FIRESTORE

#include <FirebaseClient.h>

/* ── NILM (firmware/libraries/hems_nilm_cpp — the C++ port) ──────────────
   Faithful port of the Python engine in nilm/, parity-tested against it
   (see the library's extras/parity). Install by copying the library folder
   into ~/Arduino/libraries/. The signature model is baked in at compile
   time from nilm_model.h (regenerate with nilm/tools/export_model.py after
   every train.py). If the library isn't installed the sketch still builds
   so power monitoring can be brought up first. */
#if __has_include(<hems_nilm.h>)
  #include <hems_nilm.h>
  #define HAS_NILM 1
#else
  #define HAS_NILM 0
  #warning "hems_nilm_cpp not found - appliance detection disabled for this build"
#endif

/* ═══ Sensors ═══════════════════════════════════════════════════════════ */

PZEM004Tv30 pzem1(Serial1, PZEM1_RX, PZEM1_TX); // UART1, remapped pins
PZEM004Tv30 pzem2(Serial2, PZEM2_RX, PZEM2_TX); // UART2
SoftwareSerial pzem3Serial(PZEM3_RX, PZEM3_TX);
PZEM004Tv30 pzem3(pzem3Serial);                 // binds to PZEM004Tv30(SoftwareSerial&, uint8_t=PZEM_DEFAULT_ADDR) — needs build_opt.h

struct PhaseSample {
  float p = 0, v = 0, i = 0, pf = 0, energyKwh = 0;
  bool ok = false;
};

static PhaseSample readPzem(PZEM004Tv30 &pz) {
  PhaseSample s;
  s.v = pz.voltage();
  s.i = pz.current();
  s.p = pz.power();
  s.pf = pz.pf();
  s.energyKwh = pz.energy();
  s.ok = !isnan(s.v) && !isnan(s.p);
  if (!s.ok) { s.p = 0; s.v = 0; s.i = 0; s.pf = 0; s.energyKwh = 0; }
  return s;
}

/* Reactive power, inductive assumption: Q = sqrt(max(S² − P², 0)), positive.
   VERIFIED against the training pipeline: nilm/nilm/signal.py derive_sq()
   uses the identical magnitude convention (|Q|, no leading/lagging sign),
   both for characterisation and inference — so features match by design. */
static double reactivePower(const PhaseSample &s) {
  const double apparent = (double)s.v * (double)s.i;   // S = V·I
  const double s2 = apparent * apparent, p2 = (double)s.p * (double)s.p;
  return s2 > p2 ? sqrt(s2 - p2) : 0.0;
}

/* ═══ Firebase ══════════════════════════════════════════════════════════ */

WiFiClientSecure sslWrite, sslStream;
using AsyncClient = AsyncClientClass;
AsyncClient clientWrite(sslWrite);   // /live, history, events
AsyncClient clientStream(sslStream); // /control SSE stream (its own client so
                                      // long-polling never starves writes)
/* 4th arg = token expiry in seconds, must be < 3600 (library-enforced). */
UserAuth deviceAuth(FIREBASE_API_KEY, DEVICE_EMAIL, DEVICE_PASSWORD, 3000);
FirebaseApp fbApp;
RealtimeDatabase Database;
Firestore::Documents Docs;

/* ═══ State ═════════════════════════════════════════════════════════════ */

Preferences prefs;

static PhaseSample ph1, ph2, ph3;
static float totalP = 0, totalQ = 0;
static float dailyKwh = 0;
static bool highLoad = false;
static int contactorState = 1;      // confirmed, reported in /live
static int pendingControlState = -1; // set by the stream callback, applied in loop()

/* Admin power schedule (mirrors RTDB /control/schedule). Enforced on-device
   using local time (NTP + DS3231), so it holds with the web app closed. */
static bool schedEnabled = false;
static int schedOnH = 8, schedOnM = 0, schedOffH = 18, schedOffM = 0;
static int lastSchedMinute = -1;    // minute-of-day we last evaluated (edge trigger)

/* Autonomous overload protection (config-driven, default OFF). Sustained load
   above the trip threshold cuts the contactor. The test harness can lower the
   threshold at runtime (ALRTTEST) to verify this at bench-safe wattage. */
static bool overloadTripEnabled = OVERLOAD_TRIP_ENABLED;
static float overloadTripW = OVERLOAD_TRIP_W;
static uint32_t overloadAboveSinceMs = 0;
static bool overloadCrossed = false;

static char applianceLabel[48] = "Starting up";

/* 60 s history accumulator (60 × 1 s samples) */
static float accP = 0, accL1 = 0, accL2 = 0, accL3 = 0;
static uint16_t accN = 0;

/* daily-kWh baseline (PZEM counters are lifetime-cumulative) */
static float kwhBaseline = 0;
static uint32_t baselineDay = 0; // YYYYMMDD local

static uint32_t tSample = 0, tLive = 0, tHistory = 0, tHeap = 0, tRtc = 0;
static uint32_t lastHighLoadEventMs = 0;

#if HAS_NILM
HemsNilm nilm;
#endif

#if HAS_RTC
RTC_DS3231 rtc;
static bool rtcOk = false;   // true once the DS3231 answers on I2C
#endif

/* ═══ Small helpers ═════════════════════════════════════════════════════ */

/* FirebaseClient's Database.url() wants the BARE host — no scheme, no
   trailing slash (per the library docs: Database.url("x.firebasedatabase.
   app")). A stray "https://" or trailing "/" builds a malformed request
   path and every RTDB op fails with HTTP 400 (auth still works, because
   auth hits a fixed Google endpoint, not this URL). Normalise whatever the
   user put in config.h so either form works. */
static String normalizedDbUrl() {
  String u = FIREBASE_DATABASE_URL;
  u.trim();
  if (u.startsWith("https://")) u.remove(0, 8);
  else if (u.startsWith("http://")) u.remove(0, 7);
  while (u.endsWith("/")) u.remove(u.length() - 1);
  return u;
}

static bool timeReady() { return time(nullptr) > 1700000000; } // sanity: past 2023
static int64_t epochMs() { return (int64_t)time(nullptr) * 1000LL; }

/* ── DS3231 helpers ───────────────────────────────────────────────────────
   The RTC stores UTC (Unix epoch); TZ_OFFSET_SECONDS is applied by
   localtime() for display, so everything on the RTC stays UTC. */
#if HAS_RTC
static void setSystemClock(uint32_t epoch) {
  struct timeval tv = { (time_t)epoch, 0 };
  settimeofday(&tv, nullptr);
}

/* Boot: bring the DS3231 up and seed the system clock from it, so time is
   valid IMMEDIATELY — even with no WiFi/NTP yet. */
static void rtcBegin() {
  Wire.begin(RTC_SDA, RTC_SCL);
  rtcOk = rtc.begin(&Wire);
  if (!rtcOk) {
    Serial.println("[rtc] DS3231 not found on I2C - using NTP only");
    return;
  }
  if (rtc.lostPower()) {
    Serial.println("[rtc] DS3231 lost power (unset) - will set it once NTP syncs");
  } else {
    setSystemClock(rtc.now().unixtime());
    Serial.printf("[rtc] system clock seeded from DS3231 (epoch %lu)\n",
                  (unsigned long)rtc.now().unixtime());
  }
}

/* Whenever NTP has an accurate time, write it back to the DS3231 so the RTC
   never drifts. Runs on a slow timer from loop(). */
static void rtcSyncFromNtp() {
  if (!rtcOk || !timeReady()) return;
  const uint32_t sys = (uint32_t)time(nullptr);
  const long drift = (long)sys - (long)rtc.now().unixtime();
  if (drift > 2 || drift < -2) {
    rtc.adjust(DateTime(sys));
    Serial.printf("[rtc] DS3231 synced from NTP (drift was %ld s)\n", drift);
  }
}
#endif

static uint32_t localDayStamp() {
  time_t now = time(nullptr);
  struct tm lt;
  localtime_r(&now, &lt);
  return (uint32_t)(lt.tm_year + 1900) * 10000 + (lt.tm_mon + 1) * 100 + lt.tm_mday;
}

static void driveContactor(int state) {
  const bool energize = (state == 1);
  digitalWrite(CONTACTOR_PIN, (energize == (bool)CONTACTOR_ACTIVE_HIGH) ? HIGH : LOW);
}

/* Async result logger — every Firebase task funnels through here. */
static void fbCallback(AsyncResult &res) {
  if (res.isError()) {
    Serial.printf("[fb] %s error %d: %s\n", res.uid().c_str(),
                  res.error().code(), res.error().message().c_str());
  } else if (res.isDebug()) {
    // Serial.printf("[fb-debug] %s\n", res.debug().c_str());
  }
  /* harness: log every write's success/fail (comms reliability) and, for
     appliance-event writes, the confirm half of the latency pair. A result
     is "complete" once it's no longer available/processing. No-op in prod. */
  if (res.isError() || res.available())
    testWriteResult(res.uid().c_str(), !res.isError());
}

/* Minimal JSON field scans for the fixed /control schema (avoids pulling in a
   JSON parser). `key` must include the quotes, e.g. "\"onHour\"". */
static long jsonLongAfter(const String &s, const char *key, long fallback) {
  int k = s.indexOf(key);
  if (k < 0) return fallback;
  int c = s.indexOf(':', k);
  if (c < 0) return fallback;
  return s.substring(c + 1).toInt();
}
static int jsonBoolAfter(const String &s, const char *key) { // -1 absent, else 0/1
  int k = s.indexOf(key);
  if (k < 0) return -1;
  int c = s.indexOf(':', k);
  if (c < 0) return -1;
  int i = c + 1;
  while (i < (int)s.length() && s[i] == ' ') i++;
  return s.substring(i, i + 4) == "true" ? 1 : 0;
}

/* ═══ /control stream ═══════════════════════════════════════════════════
   Streams the whole /control node so both children arrive on one SSE
   connection: contactor {state,...} (admin manual command) and schedule
   {enabled,onHour,...} (admin power schedule). The rules guarantee only
   admins can write either. Payload schema is fixed → minimal key scans. */
static void controlStreamCallback(AsyncResult &res) {
  if (res.isError()) {
    Serial.printf("[stream] error %d: %s\n", res.error().code(),
                  res.error().message().c_str());
    return;
  }
  if (!res.available()) return;

  RealtimeDatabaseResult &rtdb = res.to<RealtimeDatabaseResult>();
  if (!rtdb.isStream()) return;

  String payload = rtdb.to<String>();

  // manual contactor command
  if (payload.indexOf("\"state\"") >= 0) {
    long v = jsonLongAfter(payload, "\"state\"", -1);
    if (v == 0 || v == 1) {
      pendingControlState = (int)v; // applied on the main loop, not in callback
      Serial.printf("[stream] contactor command: %ld\n", v);
    }
  }

  // power schedule update
  if (payload.indexOf("\"onHour\"") >= 0 || payload.indexOf("\"enabled\"") >= 0) {
    int en = jsonBoolAfter(payload, "\"enabled\"");
    if (en >= 0) schedEnabled = (en == 1);
    schedOnH = (int)jsonLongAfter(payload, "\"onHour\"", schedOnH);
    schedOnM = (int)jsonLongAfter(payload, "\"onMinute\"", schedOnM);
    schedOffH = (int)jsonLongAfter(payload, "\"offHour\"", schedOffH);
    schedOffM = (int)jsonLongAfter(payload, "\"offMinute\"", schedOffM);
    lastSchedMinute = -1; // re-evaluate against the new schedule right away
    Serial.printf("[stream] schedule %s: on %02d:%02d off %02d:%02d\n",
                  schedEnabled ? "ENABLED" : "disabled",
                  schedOnH, schedOnM, schedOffH, schedOffM);
  }
}

/* ═══ RTDB /live overwrite ══════════════════════════════════════════════ */

/* NaN/Inf guard — a single 'nan' or 'inf' token in the JSON is invalid and
   RTDB rejects the whole write with HTTP 400. */
static float jsonSafe(float x) { return (isnan(x) || isinf(x)) ? 0.0f : x; }

static void publishLive() {
  if (!fbApp.ready()) return;

  /* Build the /live JSON directly. Passing raw float/bool through the
     library's JsonWriter produced malformed JSON (its create() wants
     number_t/boolean_t placeholders), which is what caused the persistent
     'live error 400'. A hand-built, NaN-guarded string is bulletproof and
     handed to the library as object_t(<json string>).
     The deviceOnline+lastUpdate heartbeat is the online signal: the REST/
     SSE client has no server-side onDisconnect(), so the web app treats a
     stale lastUpdate as offline. applianceLabel only ever holds controlled
     text (class names + ON/OFF/%), so it needs no JSON escaping. */
  char buf[640];
  snprintf(buf, sizeof(buf),
    "{"
      "\"totalPowerW\":%d,"
      "\"phases\":{"
        "\"L1\":{\"p\":%d,\"v\":%.1f,\"i\":%.2f,\"pf\":%.2f},"
        "\"L2\":{\"p\":%d,\"v\":%.1f,\"i\":%.2f,\"pf\":%.2f},"
        "\"L3\":{\"p\":%d,\"v\":%.1f,\"i\":%.2f,\"pf\":%.2f}"
      "},"
      "\"dailyKwh\":%.3f,"
      "\"costNaira\":%.2f,"
      "\"applianceLabel\":\"%s\","
      "\"contactorState\":%d,"
      "\"highLoad\":%s,"
      "\"lastUpdate\":%lld,"
      "\"deviceOnline\":true"
    "}",
    (int)lroundf(jsonSafe(totalP)),
    (int)lroundf(jsonSafe(ph1.p)), jsonSafe(ph1.v), jsonSafe(ph1.i), jsonSafe(ph1.pf),
    (int)lroundf(jsonSafe(ph2.p)), jsonSafe(ph2.v), jsonSafe(ph2.i), jsonSafe(ph2.pf),
    (int)lroundf(jsonSafe(ph3.p)), jsonSafe(ph3.v), jsonSafe(ph3.i), jsonSafe(ph3.pf),
    jsonSafe(dailyKwh),
    jsonSafe((float)(dailyKwh * TARIFF_NAIRA_PER_KWH)),
    applianceLabel,
    contactorState,
    highLoad ? "true" : "false",
    (long long)epochMs());

  testCommsAttempt("live");   // harness: comms reliability (no-op in prod)
  Database.set<object_t>(clientWrite, "/live", object_t(buf), fbCallback, "live");
}

/* ═══ Contactor actuation (manual + scheduled share one path) ═══════════ */

static void applyContactor(int state, const char *reason) {
  if (state == contactorState) return;
  driveContactor(state);
  contactorState = state;
  prefs.putInt("contactor", contactorState);
  Serial.printf("[contactor] %s -> %s\n", reason, state == 1 ? "ON" : "OFF");
  publishLive(); // confirm immediately via /live/contactorState
}

/* Enforce the admin power schedule on-device using local time. Edge-triggered
   once per minute so manual overrides between the on/off times still hold. */
static void evaluateSchedule() {
  if (!schedEnabled || !timeReady()) return;
  time_t now = time(nullptr);
  struct tm lt;
  localtime_r(&now, &lt);
  const int minuteOfDay = lt.tm_hour * 60 + lt.tm_min;
  if (minuteOfDay == lastSchedMinute) return; // already handled this minute
  lastSchedMinute = minuteOfDay;

  if (minuteOfDay == schedOnH * 60 + schedOnM) applyContactor(1, "schedule");
  else if (minuteOfDay == schedOffH * 60 + schedOffM) applyContactor(0, "schedule");
}

/* Autonomous overload protection. Independent of, and stricter than, the
   high-load alert: when armed and total load stays above the trip threshold
   for OVERLOAD_TRIP_DEBOUNCE_MS, the contactor is cut. Default disabled
   (config OVERLOAD_TRIP_ENABLED 0). The harness lowers the threshold via the
   ALRTTEST command to verify the debounce→trip logic at bench-safe wattage;
   the #ALRT markers (cross/alert/trip) time the escalation for analysis. */
static void evaluateOverloadTrip(float total) {
  const bool en = overloadTripEnabled || testOverloadEnabled();
  const float thr = testOverloadEnabled() ? testOverloadThreshW() : overloadTripW;
  if (!en) { overloadCrossed = false; overloadAboveSinceMs = 0; return; }

  if (total >= thr) {
    if (!overloadCrossed) {
      overloadCrossed = true;
      overloadAboveSinceMs = millis();
      testAlrt("cross", total);
      testAlrt("alert", total);            // alert raised immediately on the crossing
    } else if (millis() - overloadAboveSinceMs >= OVERLOAD_TRIP_DEBOUNCE_MS) {
      if (contactorState == 1) {
        testAlrt("trip", total);
        applyContactor(0, "overload");     // sustained overload → cut the building
      }
    }
  } else {
    overloadCrossed = false;
    overloadAboveSinceMs = 0;
  }
}

/* ═══ Firestore writes (downsampled — free-tier discipline) ═════════════ */

static void publishHistory() {
  if (!fbApp.ready() || !timeReady() || accN == 0) return;

  Values::MapValue phases("L1", Values::IntegerValue((int)roundf(accL1 / accN)));
  phases.add("L2", Values::IntegerValue((int)roundf(accL2 / accN)));
  phases.add("L3", Values::IntegerValue((int)roundf(accL3 / accN)));

  // Document<Values::Value> has no default constructor — the first field
  // goes in the constructor, the rest via .add() (verified against
  // FirestoreDatabase/Documents/CreateDocument). DoubleValue wraps a
  // number_t(value, decimalPlaces), not a bare double.
  Document<Values::Value> doc("ts", Values::Value(Values::IntegerValue(epochMs())));
  doc.add("avgPowerW", Values::Value(Values::IntegerValue((int)roundf(accP / accN))));
  doc.add("dailyKwh", Values::Value(Values::DoubleValue(number_t(dailyKwh, 3))));
  doc.add("costNaira", Values::Value(Values::DoubleValue(number_t(dailyKwh * TARIFF_NAIRA_PER_KWH, 2))));
  doc.add("phases", Values::Value(phases));

  testCommsAttempt("history");   // harness: comms reliability (no-op in prod)
  Docs.createDocument(clientWrite, Firestore::Parent(FIREBASE_PROJECT_ID),
                      "history", DocumentMask(), doc, fbCallback, "history");

  accP = accL1 = accL2 = accL3 = 0;
  accN = 0;
}

/* uid defaults to "event"; the NILM path passes a per-event "evt:<millis>" uid
   in test mode so the completion callback can close the latency pair. */
static void publishEvent(const char *type, const char *appliance,
                         const char *onOff, float powerW,
                         const char *uid = "event") {
  if (!fbApp.ready() || !timeReady()) return;

  Document<Values::Value> doc("ts", Values::Value(Values::IntegerValue(epochMs())));
  doc.add("type", Values::Value(Values::StringValue(type)));
  if (appliance) doc.add("appliance", Values::Value(Values::StringValue(appliance)));
  if (onOff) doc.add("event", Values::Value(Values::StringValue(onOff)));
  doc.add("powerW", Values::Value(Values::IntegerValue((int)roundf(powerW))));

  testCommsAttempt(uid);   // harness: comms reliability (no-op in prod)
  Docs.createDocument(clientWrite, Firestore::Parent(FIREBASE_PROJECT_ID),
                      "events", DocumentMask(), doc, fbCallback, uid);
}

/* ═══ Daily kWh baseline ════════════════════════════════════════════════ */

static void rollDailyBaselineIfNeeded(float lifetimeKwh) {
  if (!timeReady()) return;
  const uint32_t today = localDayStamp();
  if (today != baselineDay || lifetimeKwh + 0.001f < kwhBaseline) {
    // new local day, or a PZEM energy counter was reset — rebase
    baselineDay = today;
    kwhBaseline = lifetimeKwh;
    prefs.putUInt("day", baselineDay);
    prefs.putFloat("base", kwhBaseline);
    Serial.printf("[energy] baseline rolled: day=%u base=%.3f kWh\n",
                  baselineDay, kwhBaseline);
  }
}

/* ═══ The 1-second sensing cycle ════════════════════════════════════════
   Reads all three PZEMs, updates energy/cost and the high-load flag, and
   feeds the NILM engine one per-phase (P, Q) sample — exactly the format
   its detector was trained on. Cloud publishing happens on its own slower
   timers; sensing never waits for the network. */

static void sampleCycle() {
  /* Each PZEM read is a short Modbus transaction on its own port (~100 ms
     worst case each); three fit comfortably inside the 1 s budget. */
  ph1 = readPzem(pzem1);
  ph2 = readPzem(pzem2);
  ph3 = readPzem(pzem3);

#if DEBUG_PZEM
  /* Bench bring-up: print each phase's raw read. ok=0 means the PZEM did
     NOT respond (NaN) — a comms/power-terminal problem; ok=1 with v≈230
     means it's alive (p rises when a load draws current). Set DEBUG_PZEM 0
     in config.h once sensing is confirmed. */
  Serial.printf("[pzem] L1 ok=%d v=%.1f i=%.2f p=%.1f | L2 ok=%d v=%.1f | L3 ok=%d v=%.1f\n",
                ph1.ok, ph1.v, ph1.i, ph1.p, ph2.ok, ph2.v, ph3.ok, ph3.v);
#endif

  /* harness: one tagged CSV telemetry row per phase (no-op in production) */
  testEmitData("L1", ph1.v, ph1.i, ph1.p, ph1.energyKwh, ph1.pf);
  testEmitData("L2", ph2.v, ph2.i, ph2.p, ph2.energyKwh, ph2.pf);
  testEmitData("L3", ph3.v, ph3.i, ph3.p, ph3.energyKwh, ph3.pf);

  totalP = ph1.p + ph2.p + ph3.p;
  totalQ = (float)(reactivePower(ph1) + reactivePower(ph2) + reactivePower(ph3));

  const float lifetimeKwh = ph1.energyKwh + ph2.energyKwh + ph3.energyKwh;
  rollDailyBaselineIfNeeded(lifetimeKwh);
  dailyKwh = max(0.0f, lifetimeKwh - kwhBaseline);

  /* high load: hysteresis on the flag, debounce on the event doc */
  if (!highLoad && totalP >= HIGH_LOAD_W) {
    highLoad = true;
    if (millis() - lastHighLoadEventMs >= HIGH_LOAD_DEBOUNCE_MS) {
      lastHighLoadEventMs = millis();
      publishEvent("high_load", nullptr, nullptr, totalP);
    }
  } else if (highLoad && totalP < HIGH_LOAD_CLEAR_W) {
    highLoad = false;
  }

  /* autonomous overload protection (config-armed; harness can lower threshold) */
  evaluateOverloadTrip(totalP);

#if HAS_NILM
  /* Per-phase P and Q in the model's phase order (PZEM-1/2/3 → A/B/C).
     The engine owns detection, classification and attribution; events
     surface here as (label, ON/OFF, confidence). */
  const double p[3] = { ph1.p, ph2.p, ph3.p };
  const double q[3] = { reactivePower(ph1), reactivePower(ph2), reactivePower(ph3) };
  const double tSec = timeReady() ? (double)time(nullptr) : millis() / 1000.0;

  nilm.processSample(tSec, p, q);
  HemsNilmEvent ev;
  while (nilm.popEvent(ev)) {
    /* harness: stamp detection now and carry the id on the write uid so the
       completion callback can close the latency pair. "event" in production. */
    const char *euid = "event";
#if TEST_MODE
    static char euidbuf[24];
    const uint32_t evId = millis();
    snprintf(euidbuf, sizeof(euidbuf), "evt:%lu", (unsigned long)evId);
    euid = euidbuf;
    testEmitLatDetect(evId, ev.dP);
#endif
    if (ev.classId >= 0) {
      snprintf(applianceLabel, sizeof(applianceLabel), "%s %s (%d%%)",
               ev.label, ev.on ? "ON" : "OFF",
               (int)lroundf(ev.confidence * 100.0f));
      publishEvent("appliance", ev.label, ev.on ? "ON" : "OFF", totalP, euid);
    } else {
      /* rejected by tau: an untrained load — report honestly, don't guess */
      snprintf(applianceLabel, sizeof(applianceLabel), "Unknown load %s",
               ev.on ? "ON" : "OFF");
      publishEvent("appliance", "unknown", ev.on ? "ON" : "OFF", totalP, euid);
    }
    Serial.printf("[nilm] %s dP=%+.0fW dQ=%+.0fVAR d=%.2f -> %s\n",
                  ev.on ? "ON " : "OFF", ev.dP, ev.dQ, ev.dist, applianceLabel);
  }
#else
  snprintf(applianceLabel, sizeof(applianceLabel), "NILM unavailable");
#endif

  accP += totalP; accL1 += ph1.p; accL2 += ph2.p; accL3 += ph3.p;
  accN++;
}

/* ═══ Setup / loop ══════════════════════════════════════════════════════ */

void setup() {
  Serial.begin(115200);
  Serial.println("\nHEMS ESP32 boot");
  testBegin();   // harness banner + #DATA CSV header (no-op in production)

  /* contactor first — restore last confirmed state before anything slow */
  prefs.begin("hems", false);
  contactorState = prefs.getInt("contactor", 1);
  baselineDay = prefs.getUInt("day", 0);
  kwhBaseline = prefs.getFloat("base", 0);
  pinMode(CONTACTOR_PIN, OUTPUT);
  driveContactor(contactorState);

  /* PZEM ports — point-to-point, one sensor per UART */
  Serial1.begin(9600, SERIAL_8N1, PZEM1_RX, PZEM1_TX);
  Serial2.begin(9600, SERIAL_8N1, PZEM2_RX, PZEM2_TX);
  pzem3Serial.begin(9600, SWSERIAL_8N1, PZEM3_RX, PZEM3_TX);

#if HAS_RTC
  rtcBegin();   // seed the system clock from the DS3231 (valid time offline)
#endif

#if HAS_NILM
  nilm.begin();   // model/config baked in via nilm_model.h at compile time
  Serial.printf("[nilm] engine ready: %d classes\n", HemsNilm::numClasses());
#endif

  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("WiFi connecting");
  /* bounded wait: sensing must not be held hostage by the network */
  for (int i = 0; i < 40 && WiFi.status() != WL_CONNECTED; i++) {
    delay(250); // setup()-only; the main loop never blocks
    Serial.print('.');
  }
  Serial.printf("\nWiFi: %s\n",
                WiFi.status() == WL_CONNECTED ? WiFi.localIP().toString().c_str()
                                              : "not connected (will retry)");

  configTime(TZ_OFFSET_SECONDS, 0, "pool.ntp.org", "time.nist.gov");

  /* TLS: certificate pinning is impractical to maintain on-device; auth +
     security rules carry the trust model on the free tier. */
  sslWrite.setInsecure();
  sslStream.setInsecure();

  initializeApp(clientWrite, fbApp, getAuth(deviceAuth), fbCallback, "auth");
  fbApp.getApp<RealtimeDatabase>(Database);
  Database.url(normalizedDbUrl());   // bare host — see normalizedDbUrl()
  fbApp.getApp<Firestore::Documents>(Docs);

  // Stream the whole /control node so both contactor commands and schedule
  // changes arrive on one SSE connection.
  clientStream.setSSEFilters("get,put,patch,keep-alive,cancel,auth_revoked");
  Database.get(clientStream, "/control", controlStreamCallback,
               true /* SSE stream */, "controlStream");
}

void loop() {
  // Pumps auth refresh + all async Firebase tasks (RTDB, stream, Firestore).
  // RealtimeDatabase/Firestore::Documents have no loop() of their own.
  fbApp.loop();

  testPollSerial();   // harness: read LOAD/RELAYTEST/ALRTTEST/PWR commands (no-op in prod)

  const uint32_t now = millis();

#if TEST_MODE
  /* relay switching test: drive the contactor raw (no NVS/publish churn),
     read state back from the largest phase current, restore afterwards. */
  {
    static bool rlyWas = false;
    const float maxI = max(ph1.i, max(ph2.i, ph3.i));
    const int cmd = testRelayCommand(now, maxI);
    if (cmd >= 0) driveContactor(cmd);
    const bool act = testRelayActive();
    if (rlyWas && !act) driveContactor(contactorState);   // restore true state
    rlyWas = act;
  }
  /* comms: mark Wi-Fi drop/restore transitions for the reconnect-time metric */
  {
    static bool wifiWas = true;
    const bool wifiNow = (WiFi.status() == WL_CONNECTED);
    if (wifiNow != wifiWas) { testWifi(wifiNow); wifiWas = wifiNow; }
  }
#endif

  /* admin command arrived on the stream → actuate → confirm via /live */
  if (pendingControlState >= 0) {
    const int target = pendingControlState;
    pendingControlState = -1;
    applyContactor(target, "manual");
  }

  if (now - tSample >= SAMPLE_INTERVAL_MS) {
    tSample = now;
    sampleCycle();     // sensing + NILM keep running even with WiFi down
    evaluateSchedule(); // enforce the admin power schedule (once per minute)
  }

  if (now - tLive >= LIVE_PUBLISH_MS) {
    tLive = now;
    publishLive(); // 5 s overwrite of RTDB /live (free-tier discipline)
  }

  if (now - tHistory >= HISTORY_INTERVAL_MS) {
    tHistory = now;
    publishHistory();
  }

#if HAS_RTC
  if (now - tRtc >= 60000UL) {   // keep the DS3231 aligned with NTP
    tRtc = now;
    rtcSyncFromNtp();
  }
#endif

  if (now - tHeap >= HEAP_LOG_INTERVAL_MS) {
    tHeap = now;
    /* TLS ×2 + Firebase + UART buffers + NILM is a real RAM load — watch it.
       Expect ~120–170 kB free after both TLS sessions are up; investigate
       anything trending below ~60 kB (see FIRMWARE_GUIDE.md). */
    Serial.printf("[heap] free=%u minFree=%u\n",
                  ESP.getFreeHeap(), ESP.getMinFreeHeap());
#if HAS_RTC
    if (rtcOk) {
      DateTime t = rtc.now();
      Serial.printf("[rtc] %04d-%02d-%02d %02d:%02d:%02d UTC  temp=%.1fC\n",
                    t.year(), t.month(), t.day(), t.hour(), t.minute(), t.second(),
                    rtc.getTemperature());
    }
#endif
  }
}

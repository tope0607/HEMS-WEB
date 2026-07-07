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

static char applianceLabel[48] = "Starting up";

/* 60 s history accumulator (60 × 1 s samples) */
static float accP = 0, accL1 = 0, accL2 = 0, accL3 = 0;
static uint16_t accN = 0;

/* daily-kWh baseline (PZEM counters are lifetime-cumulative) */
static float kwhBaseline = 0;
static uint32_t baselineDay = 0; // YYYYMMDD local

static uint32_t tSample = 0, tLive = 0, tHistory = 0, tHeap = 0;
static uint32_t lastHighLoadEventMs = 0;

#if HAS_NILM
HemsNilm nilm;
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
}

/* ═══ /control/contactor stream ═════════════════════════════════════════
   Admin writes {state, requestedBy, requestedAt}; the rules guarantee only
   admins can. We only need `state`; the payload schema is fixed, so a
   minimal scan beats pulling in a JSON library. */
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
  int keyAt = payload.indexOf("\"state\"");
  if (keyAt < 0) return;
  int colonAt = payload.indexOf(':', keyAt);
  if (colonAt < 0) return;
  int value = payload.substring(colonAt + 1).toInt();
  if (value == 0 || value == 1) {
    pendingControlState = value; // applied on the main loop, not in callback
    Serial.printf("[stream] contactor command: %d\n", value);
  }
}

/* ═══ RTDB /live overwrite ══════════════════════════════════════════════ */

static void publishLive() {
  if (!fbApp.ready()) return;

  JsonWriter writer;
  object_t json, phases, o1, o2, o3, tmp1, tmp2, tmp3, tmp4;

  auto phaseObj = [&](object_t &out, const PhaseSample &s) {
    object_t a, b, c, d;
    writer.create(a, "p", (int)roundf(s.p));
    writer.create(b, "v", s.v);
    writer.create(c, "i", s.i);
    writer.create(d, "pf", s.pf);
    writer.join(out, 4, a, b, c, d);
  };
  phaseObj(o1, ph1); phaseObj(o2, ph2); phaseObj(o3, ph3);
  writer.create(tmp1, "L1", o1);
  writer.create(tmp2, "L2", o2);
  writer.create(tmp3, "L3", o3);
  writer.join(phases, 3, tmp1, tmp2, tmp3);

  object_t f1, f2, f3, f4, f5, f6, f7, f8, f9;
  writer.create(f1, "totalPowerW", (int)roundf(totalP));
  writer.create(f2, "phases", phases);
  writer.create(f3, "dailyKwh", dailyKwh);
  writer.create(f4, "costNaira", dailyKwh * TARIFF_NAIRA_PER_KWH);
  writer.create(f5, "applianceLabel", applianceLabel);
  writer.create(f6, "contactorState", contactorState);
  writer.create(f7, "highLoad", highLoad);
  writer.create(f8, "lastUpdate", epochMs());
  /* The web app treats a stale lastUpdate as offline: the REST/SSE client
     library has no true RTDB onDisconnect() handler, so freshness of this
     heartbeat IS the online signal.
     TODO: verify — if your FirebaseClient version gained onDisconnect
     support, register it here instead. */
  writer.create(f9, "deviceOnline", true);
  writer.join(json, 9, f1, f2, f3, f4, f5, f6, f7, f8, f9);

  Database.set<object_t>(clientWrite, "/live", json, fbCallback, "live");
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

  Docs.createDocument(clientWrite, Firestore::Parent(FIREBASE_PROJECT_ID),
                      "history", DocumentMask(), doc, fbCallback, "history");

  accP = accL1 = accL2 = accL3 = 0;
  accN = 0;
}

static void publishEvent(const char *type, const char *appliance,
                         const char *onOff, float powerW) {
  if (!fbApp.ready() || !timeReady()) return;

  Document<Values::Value> doc("ts", Values::Value(Values::IntegerValue(epochMs())));
  doc.add("type", Values::Value(Values::StringValue(type)));
  if (appliance) doc.add("appliance", Values::Value(Values::StringValue(appliance)));
  if (onOff) doc.add("event", Values::Value(Values::StringValue(onOff)));
  doc.add("powerW", Values::Value(Values::IntegerValue((int)roundf(powerW))));

  Docs.createDocument(clientWrite, Firestore::Parent(FIREBASE_PROJECT_ID),
                      "events", DocumentMask(), doc, fbCallback, "event");
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
    if (ev.classId >= 0) {
      snprintf(applianceLabel, sizeof(applianceLabel), "%s %s (%d%%)",
               ev.label, ev.on ? "ON" : "OFF",
               (int)lroundf(ev.confidence * 100.0f));
      publishEvent("appliance", ev.label, ev.on ? "ON" : "OFF", totalP);
    } else {
      /* rejected by tau: an untrained load — report honestly, don't guess */
      snprintf(applianceLabel, sizeof(applianceLabel), "Unknown load %s",
               ev.on ? "ON" : "OFF");
      publishEvent("appliance", "unknown", ev.on ? "ON" : "OFF", totalP);
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

  // Restrict the SSE stream to the event types we act on.
  clientStream.setSSEFilters("get,put,patch,keep-alive,cancel,auth_revoked");
  Database.get(clientStream, "/control/contactor", controlStreamCallback,
               true /* SSE stream */, "controlStream");
}

void loop() {
  // Pumps auth refresh + all async Firebase tasks (RTDB, stream, Firestore).
  // RealtimeDatabase/Firestore::Documents have no loop() of their own.
  fbApp.loop();

  const uint32_t now = millis();

  /* admin command arrived on the stream → actuate → confirm via /live */
  if (pendingControlState >= 0) {
    const int target = pendingControlState;
    pendingControlState = -1;
    if (target != contactorState) {
      driveContactor(target);
      contactorState = target;
      prefs.putInt("contactor", contactorState);
      Serial.printf("[contactor] switched %s\n", target == 1 ? "ON" : "OFF");
      publishLive(); // immediate confirmation, don't wait for the next cycle
    }
  }

  if (now - tSample >= SAMPLE_INTERVAL_MS) {
    tSample = now;
    sampleCycle(); // sensing + NILM keep running even with WiFi down
  }

  if (now - tLive >= LIVE_PUBLISH_MS) {
    tLive = now;
    publishLive(); // 5 s overwrite of RTDB /live (free-tier discipline)
  }

  if (now - tHistory >= HISTORY_INTERVAL_MS) {
    tHistory = now;
    publishHistory();
  }

  if (now - tHeap >= HEAP_LOG_INTERVAL_MS) {
    tHeap = now;
    /* TLS ×2 + Firebase + UART buffers + NILM is a real RAM load — watch it.
       Expect ~120–170 kB free after both TLS sessions are up; investigate
       anything trending below ~60 kB (see FIRMWARE_GUIDE.md). */
    Serial.printf("[heap] free=%u minFree=%u\n",
                  ESP.getFreeHeap(), ESP.getMinFreeHeap());
  }
}

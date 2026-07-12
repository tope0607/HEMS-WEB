#pragma once
/* ═══════════════════════════════════════════════════════════════════════════
   HEMS evaluation test-mode instrumentation  (Objective 4 harness)

   Purpose: add greppable, tagged Serial logging + a few bench-test routines
   AROUND the production firmware without changing any metering/NILM/Firebase
   logic. Everything here is compiled out unless TEST_MODE is 1, so the
   production build is byte-for-byte unchanged.

   This module is deliberately self-contained: it never touches the sketch's
   globals. The sketch queries it (getters) and hands it primitives to log.
   That keeps the .ino diff to a handful of one-line, guarded hook calls.

   Enable the harness by building with TEST_MODE=1 — either flip the line
   below, or add `-DTEST_MODE=1` to build_opt.h for the test build.

   Documentation of every tag/line format + the run order lives in
   evaluation/README.md and evaluation/firmware_test_mode/README.md.
   ═══════════════════════════════════════════════════════════════════════ */

#ifndef TEST_MODE
#define TEST_MODE 0
#endif

/* Current (A) above which a phase is considered "energised" for the relay
   read-back proxy, and the default relay-cycle count/interval. */
#ifndef TEST_RELAY_ON_CURRENT_A
#define TEST_RELAY_ON_CURRENT_A 0.20f
#endif
#ifndef TEST_RELAY_TRIALS
#define TEST_RELAY_TRIALS 20
#endif
#ifndef TEST_RELAY_INTERVAL_MS
#define TEST_RELAY_INTERVAL_MS 3000UL
#endif

#if TEST_MODE
/* ═════════════════════════ TEST_MODE == 1 ═════════════════════════════════ */
#include <Arduino.h>
#include <time.h>
#include <string.h>
#include <strings.h>   // strcasecmp (POSIX; provided by the ESP32 newlib toolchain)
#include <stdlib.h>

/* ── accuracy: currently-connected load tag (set by `LOAD <name> <ratedW>`) */
static char  _tLoad[24]  = "";
static float _tRated     = 0.0f;

/* ── overload-trip test override (set by `ALRTTEST <W>`) ── */
static bool  _tOverEn    = false;
static float _tOverW     = 0.0f;

/* ── relay switching test state machine ── */
static bool     _rlyActive   = false;
static int      _rlyTrials   = 0;    // total trials requested
static int      _rlyIdx      = 0;    // current trial
static uint32_t _rlyInterval = TEST_RELAY_INTERVAL_MS;
static int      _rlyCmd      = -1;   // commanded state this trial
static uint32_t _rlyTs       = 0;    // when the command was issued
static bool     _rlySettling = false;

static uint32_t _nowMs() { return millis(); }

/* ISO-8601 local timestamp into a shared static buffer (all three phase rows
   of one sample share the same second, so one buffer is fine). Falls back to
   uptime seconds before the clock is set. */
static const char *_isoNow() {
  static char b[24];
  time_t t = time(nullptr);
  if (t > 1700000000) {
    struct tm lt;
    localtime_r(&t, &lt);
    strftime(b, sizeof(b), "%Y-%m-%dT%H:%M:%S", &lt);
  } else {
    snprintf(b, sizeof(b), "uptime+%lus", (unsigned long)(millis() / 1000));
  }
  return b;
}

/* ───────────────────────── serial command parser ───────────────────────── */

static void _testHelp() {
  Serial.println(F("# ── HEMS test-mode commands ─────────────────────────────"));
  Serial.println(F("#  LOAD <name> <ratedW>   tag telemetry with the load under test"));
  Serial.println(F("#  LOAD off               clear the load tag"));
  Serial.println(F("#  RELAYTEST [N] [ms]     cycle the contactor N times (default 20, 3000ms)"));
  Serial.println(F("#  ALRTTEST <W>           arm overload-trip test at reduced threshold W"));
  Serial.println(F("#  ALRTTEST off           disarm the overload-trip test"));
  Serial.println(F("#  PWR <V> <A>            log a measured controller-supply reading"));
  Serial.println(F("#  HELP                   this list"));
  Serial.println(F("# ────────────────────────────────────────────────────────"));
}

static void _handleLine(char *line) {
  // strip trailing CR/LF/space
  int n = strlen(line);
  while (n > 0 && (line[n - 1] == '\r' || line[n - 1] == '\n' || line[n - 1] == ' '))
    line[--n] = 0;
  if (n == 0) return;

  char cmd[16] = "";
  sscanf(line, "%15s", cmd);

  if (!strcasecmp(cmd, "LOAD")) {
    char name[24] = ""; float rated = 0;
    if (sscanf(line, "%*s %23s %f", name, &rated) >= 1) {
      if (!strcasecmp(name, "off")) {
        _tLoad[0] = 0; _tRated = 0;
        Serial.println(F("# LOAD cleared"));
      } else {
        strncpy(_tLoad, name, sizeof(_tLoad) - 1); _tLoad[sizeof(_tLoad) - 1] = 0;
        _tRated = rated;
        Serial.printf("# LOAD set: %s rated=%.0fW\n", _tLoad, _tRated);
      }
    }
  } else if (!strcasecmp(cmd, "RELAYTEST")) {
    int trials = TEST_RELAY_TRIALS; unsigned long ms = TEST_RELAY_INTERVAL_MS;
    sscanf(line, "%*s %d %lu", &trials, &ms);
    _rlyActive = true; _rlyTrials = trials; _rlyIdx = 0;
    _rlyInterval = ms; _rlyCmd = -1; _rlySettling = false;
    Serial.printf("#RLY,start,%d,%lu\n", trials, ms);
  } else if (!strcasecmp(cmd, "ALRTTEST")) {
    char arg[8] = ""; float w = 0;
    sscanf(line, "%*s %7s", arg);
    if (!strcasecmp(arg, "off")) {
      _tOverEn = false;
      Serial.println(F("#ALRT,config,off"));
    } else if (sscanf(line, "%*s %f", &w) == 1 && w > 0) {
      _tOverEn = true; _tOverW = w;
      Serial.printf("#ALRT,config,%.0f\n", w);   // debounce is the firmware's OVERLOAD_TRIP_DEBOUNCE_MS
    }
  } else if (!strcasecmp(cmd, "PWR")) {
    float v = 0, a = 0;
    if (sscanf(line, "%*s %f %f", &v, &a) == 2)
      Serial.printf("#PWR,measured,%.3f,%.3f,%.3f\n", v, a, v * a);
  } else if (!strcasecmp(cmd, "HELP")) {
    _testHelp();
  }
}

/* Non-blocking line reader — call every loop(). */
static void testPollSerial() {
  static char buf[64];
  static int  len = 0;
  while (Serial.available()) {
    char c = (char)Serial.read();
    if (c == '\n' || c == '\r') {
      if (len > 0) { buf[len] = 0; _handleLine(buf); len = 0; }
    } else if (len < (int)sizeof(buf) - 1) {
      buf[len++] = c;
    }
  }
}

/* ───────────────────────────── getters ─────────────────────────────────── */

static bool  testOverloadEnabled() { return _tOverEn; }
static float testOverloadThreshW() { return _tOverW; }
static bool  testRelayActive()     { return _rlyActive; }

/* Relay state machine. Call every loop() with the current time and the
   largest per-phase current (the load may sit on any phase). Returns the
   contactor state to command this tick (0/1), or -1 for "no change". The
   sketch applies the returned command with driveContactor(). */
static int testRelayCommand(uint32_t now, float maxCurrentA) {
  if (!_rlyActive) return -1;

  if (!_rlySettling) {
    // issue the command for this trial (alternate OFF/ON so both are exercised)
    _rlyCmd = (_rlyIdx % 2 == 0) ? 0 : 1;
    _rlyTs = now; _rlySettling = true;
    return _rlyCmd;                       // sketch drives the relay now
  }

  if (now - _rlyTs >= _rlyInterval) {      // settle window elapsed → read back
    int confirmed = (maxCurrentA > TEST_RELAY_ON_CURRENT_A) ? 1 : 0;
    const char *result = (confirmed == _rlyCmd) ? "OK" : "MISMATCH";
    Serial.printf("#RLY,%d,%d,%d,%s\n", _rlyIdx, _rlyCmd, confirmed, result);
    _rlyIdx++; _rlySettling = false;
    if (_rlyIdx >= _rlyTrials) {
      _rlyActive = false;
      Serial.printf("#RLY,done,%d\n", _rlyTrials);
    }
  }
  return -1;
}

/* ───────────────────────────── emitters ────────────────────────────────── */

static void testBegin() {
  Serial.println(F("\n# ═══ HEMS TEST MODE ENABLED ═══"));
  Serial.println(F("#DATA,timestamp_iso,phase,voltage_v,current_a,power_w,energy_wh,pf,load_label,rated_w"));
  _testHelp();
}

/* One telemetry row per phase (energy converted kWh→Wh). load_label/rated_w
   are blank until a `LOAD` command tags the window. */
static void testEmitData(const char *phase, float v, float i, float p,
                         float energyKwh, float pf) {
  Serial.printf("#DATA,%s,%s,%.1f,%.2f,%.1f,%.1f,%.2f,%s,%.0f\n",
                _isoNow(), phase, v, i, p, energyKwh * 1000.0f, pf,
                _tLoad, _tRated);
}

/* Latency: detection instant. id = millis() at detection, echoed back on the
   matching write-confirm so analysis can difference them. */
static void testEmitLatDetect(uint32_t id, float dP) {
  Serial.printf("#LAT,detect,%lu,%.0f\n", (unsigned long)id, dP);
}

/* Called from the Firebase completion callback for every result. If the uid
   is an appliance-event uid ("evt:<id>"), emit the confirm half of the pair.
   Always update comms counters + emit a #COMM result line. */
static void testWriteResult(const char *uid, bool ok) {
  Serial.printf("#COMM,result,%s,%s,%lu\n", uid, ok ? "ok" : "fail",
                (unsigned long)_nowMs());
  if (!strncmp(uid, "evt:", 4)) {
    unsigned long id = strtoul(uid + 4, nullptr, 10);
    Serial.printf("#LAT,confirm,%lu,%lu\n", id, (unsigned long)_nowMs());
  }
}

static void testCommsAttempt(const char *uid) {
  Serial.printf("#COMM,attempt,%s,%lu\n", uid, (unsigned long)_nowMs());
}

static void testWifi(bool up) {
  Serial.printf("#COMM,wifi,%s,%lu\n", up ? "up" : "down", (unsigned long)_nowMs());
}

/* Overload-trip escalation markers (reduced-threshold functional test). */
static void testAlrt(const char *stage, float w) {
  Serial.printf("#ALRT,%s,%lu,%.0f\n", stage, (unsigned long)_nowMs(), w);
}

#else
/* ═════════════════════════ TEST_MODE == 0 (production) ════════════════════
   All hooks become no-ops the optimiser deletes. Production is unchanged. */
static inline void  testBegin() {}
static inline void  testPollSerial() {}
static inline void  testEmitData(const char *, float, float, float, float, float) {}
static inline void  testEmitLatDetect(uint32_t, float) {}
static inline void  testWriteResult(const char *, bool) {}
static inline void  testCommsAttempt(const char *) {}
static inline void  testWifi(bool) {}
static inline void  testAlrt(const char *, float) {}
static inline bool  testOverloadEnabled() { return false; }
static inline float testOverloadThreshW() { return 0.0f; }
static inline bool  testRelayActive() { return false; }
static inline int   testRelayCommand(uint32_t, float) { return -1; }
#endif

/*
 * HEMS NILM sensing node  -  ESP32-WROOM-32UE + 3x PZEM-004T v3.0
 * ---------------------------------------------------------------
 * Reads one PZEM per phase at 1 Hz and publishes a JSON sample to MQTT.
 * The ESP32 stays a dumb, reliable publisher; ALL disaggregation logic
 * (event detection, k-NN, attribution) runs in the Python backend, so the
 * exact same code path serves simulator, CSV replay, and live hardware.
 *
 * Published topic "hems/samples", payload:
 *   {"t":<unix s>,"phases":{"A":{"P":..,"Q":..,"V":..,"I":..,"PF":..,"E":..}, "B":{...}, "C":{...}}}
 * Q is derived (the PZEM does not report it): S=V*I, Q=sqrt(S^2 - P^2).
 *
 * WIRING NOTE (matches the comms discussion):
 *   Three TTL PZEM-004T CANNOT share one ESP32 RX line (push-pull TX
 *   contention). Each module gets its own UART: Serial1, Serial2, and a
 *   SoftwareSerial. If you instead bought the RS-485 variant (PZEM-016),
 *   delete the three serials, wire all meters to ONE MAX485 on a single
 *   UART, and read them by Modbus address in a loop (see readRs485() stub).
 *
 * ANTENNA NOTE: the WROOM-32UE has a U.FL connector - fit the external
 * antenna and route it outside the metal DB enclosure or WiFi will drop.
 *
 * Libraries (install via Library Manager):
 *   - PZEM-004T-v30   (by Jakub Mandula)
 *   - PubSubClient    (by Nick O'Leary)
 *   - ArduinoJson     (by Benoit Blanchon)
 *   - EspSoftwareSerial (bundled with ESP32 core)
 */

#include <WiFi.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <PZEM004Tv30.h>
#include <SoftwareSerial.h>
#include <math.h>
#include <time.h>

// ---------- user config ----------
const char* WIFI_SSID = "YOUR_WIFI";
const char* WIFI_PASS = "YOUR_PASS";
const char* MQTT_HOST = "192.168.1.10";   // broker running the Python backend
const uint16_t MQTT_PORT = 1883;
const char* MQTT_TOPIC = "hems/samples";
const uint32_t PERIOD_MS = 1000;           // 1 Hz; PZEM refreshes ~once/second

// ---------- PZEM on three separate UARTs ----------
// Hardware UART1 / UART2 (pins are remappable on the ESP32 GPIO matrix)
PZEM004Tv30 pzemA(Serial1, 16, 17);        // phase A: RX=16, TX=17
PZEM004Tv30 pzemB(Serial2, 18, 19);        // phase B: RX=18, TX=19
SoftwareSerial swSerial(25, 26);           // phase C: RX=25, TX=26
PZEM004Tv30 pzemC(swSerial);

WiFiClient net;
PubSubClient mqtt(net);
uint32_t lastTick = 0;

struct Reading { float P, Q, V, I, PF, E; bool ok; };

Reading readPhase(PZEM004Tv30 &m) {
  Reading r{0, 0, 0, 0, 1, 0, false};
  float v = m.voltage();
  float p = m.power();
  if (isnan(v) || isnan(p)) return r;       // bad read this cycle -> flagged
  float i  = m.current();
  float pf = m.pf();
  float e  = m.energy() * 1000.0f;          // kWh -> Wh
  float s  = v * (isnan(i) ? 0.0f : i);
  float q2 = s * s - p * p;
  r = { p, q2 > 0 ? sqrtf(q2) : 0.0f, v, isnan(i) ? 0.0f : i,
        isnan(pf) ? 1.0f : pf, isnan(e) ? 0.0f : e, true };
  return r;
}

void addPhase(JsonObject phases, const char* name, const Reading &r) {
  JsonObject o = phases.createNestedObject(name);
  o["P"] = r.P; o["Q"] = r.Q; o["V"] = r.V;
  o["I"] = r.I; o["PF"] = r.PF; o["E"] = r.E; o["ok"] = r.ok;
}

void ensureConnected() {
  if (WiFi.status() != WL_CONNECTED) {
    WiFi.begin(WIFI_SSID, WIFI_PASS);
    while (WiFi.status() != WL_CONNECTED) { delay(300); }
  }
  while (!mqtt.connected()) {
    if (mqtt.connect("hems-node-1")) break;
    delay(1000);
  }
}

void setup() {
  Serial.begin(115200);
  WiFi.mode(WIFI_STA);
  mqtt.setServer(MQTT_HOST, MQTT_PORT);
  mqtt.setBufferSize(512);
  configTime(0, 0, "pool.ntp.org");          // NTP for real timestamps
  ensureConnected();
}

void loop() {
  ensureConnected();
  mqtt.loop();

  uint32_t now = millis();
  if (now - lastTick < PERIOD_MS) return;
  lastTick = now;

  Reading a = readPhase(pzemA);
  Reading b = readPhase(pzemB);
  Reading c = readPhase(pzemC);

  StaticJsonDocument<512> doc;
  doc["t"] = (uint32_t)time(nullptr);
  JsonObject phases = doc.createNestedObject("phases");
  addPhase(phases, "A", a);
  addPhase(phases, "B", b);
  addPhase(phases, "C", c);

  char buf[512];
  size_t n = serializeJson(doc, buf);
  mqtt.publish(MQTT_TOPIC, buf, n);
}

/* ---- RS-485 single-bus alternative (PZEM-016), sketch only ----
 * One MAX485 on one UART; each meter has a unique Modbus address.
 *   PZEM004Tv30 pzem(Serial1, RX, TX, addr);  // addr per meter: 0x01,0x02,0x03
 * Loop over the three addresses each cycle. Set addresses once with
 * pzem.setAddress(addr) while only that meter is on the bus.
 */

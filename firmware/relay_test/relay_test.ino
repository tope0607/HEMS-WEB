/* ───────────────────────────────────────────────────────────────────────────
   Standalone relay / contactor bring-up test.

   No WiFi, no Firebase, no PZEM, no NILM — this sketch does ONE thing: toggle
   the relay pin ON/OFF every 2 seconds and print what it's doing. Use it to
   isolate the GPIO → relay → contactor path from the whole HEMS firmware.

   If the relay clicks with this sketch, the hardware path is fine and the
   problem was a config mismatch in the main firmware (CONTACTOR_PIN /
   CONTACTOR_ACTIVE_HIGH). If it does NOT click here, the fault is hardware:
   relay-module power, the 3.3V drive, wiring, or a dead module — and the
   Serial + multimeter steps in the chat tell you which.

   HOW TO USE
     1. Open this in Arduino IDE (Board: ESP32 Dev Module), flash it.
     2. Open Serial Monitor @115200. You'll see [relay] ON / OFF every 2 s.
     3. Listen for the relay click and/or watch a bulb on the contactor.
     4. Put a multimeter on RELAY_PIN → GND: it MUST swing 3.3V ↔ 0V each toggle.
   ─────────────────────────────────────────────────────────────────────────── */

#define RELAY_PIN     23     // <-- the GPIO your relay IN wire is actually on
#define ACTIVE_HIGH    1     // 1: HIGH energises the relay; 0: LOW energises
#define PERIOD_MS   2000     // toggle every 2 seconds

static void driveRelay(bool on) {
  // energise level depends on the board: active-HIGH boards want HIGH to turn on
  digitalWrite(RELAY_PIN, (on == (bool)ACTIVE_HIGH) ? HIGH : LOW);
}

void setup() {
  Serial.begin(115200);
  delay(400);
  Serial.println("\n=== STANDALONE RELAY TEST ===");
  Serial.printf("RELAY_PIN=%d  ACTIVE_HIGH=%d  period=%d ms\n",
                RELAY_PIN, ACTIVE_HIGH, PERIOD_MS);
  Serial.println("Listen for the relay click / watch a bulb on the contactor.");
  Serial.println("Meter RELAY_PIN->GND: it must swing 3.3V <-> 0V on each toggle.");
  Serial.println("If the pin swings but the relay stays silent -> power/3.3V-drive issue.\n");
  pinMode(RELAY_PIN, OUTPUT);
  driveRelay(false);          // start de-energised
}

void loop() {
  static bool on = false;
  static uint32_t t = 0;
  if (millis() - t >= PERIOD_MS) {
    t = millis();
    on = !on;
    driveRelay(on);
    Serial.printf("[relay] %s  -> pin %d driven %s\n",
                  on ? "ON " : "OFF", RELAY_PIN,
                  (on == (bool)ACTIVE_HIGH) ? "HIGH (3.3V)" : "LOW (0V)");
  }
}

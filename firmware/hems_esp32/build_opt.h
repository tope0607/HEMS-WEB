# HEMS: force PZEM004Tv30's SoftwareSerial/Stream constructors on for ESP32.
#
# PZEM004Tv30.h only auto-enables PZEM004_SOFTSERIAL for __AVR__ / ESP8266,
# never ESP32 — and both its PZEM004Tv30(SoftwareSerial&, uint8_t) and
# PZEM004Tv30(Stream&, uint8_t) constructors sit inside that same
# "#if defined(PZEM004_SOFTSERIAL)" block, in BOTH the header the sketch
# sees and the library's own separately-compiled .cpp. A plain #define in
# the .ino only reaches the sketch's own translation unit, so it makes our
# sketch declare a call to a constructor the library's .cpp never actually
# builds an implementation for -> "undefined reference" at link time (or,
# if the #define is removed, "no matching function" at compile time,
# because then neither side declares it).
#
# build_opt.h (arduino-esp32 core feature) is the fix: every line here is
# injected as a compiler flag into EVERY file the build compiles - sketch
# AND libraries - so the declaration and the implementation finally agree.
#
# If this doesn't seem to take effect after editing it, Arduino IDE's core
# cache can go stale: Settings -> uncheck "Aggressively cache compiled
# core", or just do one clean rebuild.
-DPZEM004_SOFTSERIAL

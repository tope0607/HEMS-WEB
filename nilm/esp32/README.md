# Lab node (characterisation only — NOT the production firmware)

`esp32_hems_node.ino` is the sketch that shipped with the NILM engine: a
"dumb publisher" that streams 1 Hz per-phase samples over **MQTT** to a
laptop running the Python engine (`python run.py --mqtt <host>`).

Its one remaining job in this project is the **bench characterisation
campaign**: streaming live PZEM samples to the desktop so appliance ON/OFF
deltas can be recorded into the training CSV (see
`docs/NILM_INTEGRATION.md`, Step 1).

Do **not** deploy it in the building:

- it needs a broker + always-on PC, which the HEMS architecture forbids;
- it does not talk to Firebase, drive the contactor, or track energy;
- its pin map differs from the production sketch (it puts a PZEM on
  GPIO 25/26 — GPIO 25 is the contactor pin in `firmware/hems_esp32`).

The production firmware is `firmware/hems_esp32/hems_esp32.ino`, which runs
the same NILM engine **on the ESP32** via `firmware/libraries/hems_nilm_cpp`.

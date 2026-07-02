# HEMS — Home Energy Management System

Three-phase home energy monitoring and control for a Mechatronics capstone.
An **ESP32-WROOM-32UE** senses three phases through 3× PZEM-004T, runs NILM
appliance detection on-device, and drives a master contactor. **Firebase**
(Spark/free tier) is the connective layer — auth, realtime sync, history,
hosting. A **React + Vite** web app gives role-gated live monitoring, history,
and (admins only) remote contactor control.

```
PZEM-004T ×3 ─► ESP32 ─► RTDB /live (5 s overwrite) ─► Web app (React+Vite)
                  │       RTDB /control ◄────────────── admin toggle
                  │       Firestore history/ (60 s), events/, users/
                  └─► master contactor
```

No Raspberry Pi, no backend server: all processing is on the ESP32, Firebase
is infrastructure only.

## Repository layout

| Path | What |
|---|---|
| `database.rules.json`, `firestore.rules` | security rules — roles enforced **at the DB** |
| `SECURITY_RULES.md` | what each rule does and why |
| `scripts/seed.mjs` | creates admin / user / device accounts + role claims |
| `tests/rules.test.mjs` | emulator proof of the rules (12 tests) |
| `web/` | the React + Vite SPA (dark/light instrument-panel UI) |
| `docs/screenshots/` | desktop + mobile × dark + light × admin + user |
| `firmware/hems_esp32/` | Arduino sketch + `config.h` |
| `firmware/FIRMWARE_GUIDE.md` | board setup, libraries, pin map, bring-up |

## Quick start (no hardware, no Firebase project)

```bash
cd web && npm install && npm run dev
```

Without Firebase env keys the app runs in **demo mode**: a deterministic
simulated building (live ticks, history, NILM events, contactor round-trip)
plus mock auth — `admin@demo.hems` / `user@demo.hems`, any password of 4+
characters. Every screen is fully demoable.

## Real deployment

1. **Create a Firebase project** (Spark plan): enable Email/Password auth,
   Realtime Database, Firestore, Hosting. Put the project id in `.firebaserc`.
2. **Rules + seed:**
   ```bash
   npm install                 # repo root
   npm run deploy:rules
   # service account key → seed the three accounts + role claims:
   export GOOGLE_APPLICATION_CREDENTIALS=./serviceAccountKey.json
   export FIREBASE_DATABASE_URL=https://<project>-default-rtdb.firebaseio.com
   SEED_ADMIN_PASSWORD=... SEED_USER_PASSWORD=... SEED_DEVICE_PASSWORD=... npm run seed
   ```
3. **Web app:** copy `.env.example` → `.env`, fill the `VITE_FIREBASE_*` keys
   (client-safe; the rules are the protection), then
   `npm run deploy:hosting`.
4. **Firmware:** follow `firmware/FIRMWARE_GUIDE.md` (libraries, pin map,
   device credentials, bring-up).

## Verifying the security model

```bash
npm run test:rules
```

Runs 12 tests against the Auth + RTDB + Firestore emulators, including the two
gate checks: a **user** account is denied writing `/control`, and the
**device** account is denied changing any role. Roles travel as custom claims
set only by the Admin SDK — see `SECURITY_RULES.md` for the full story.

## Free-tier discipline

- 5 s live data **overwrites** one RTDB node — never appended, never Firestore.
- Firestore gets one downsampled `history` doc per 60 s (≈1,440 writes/day,
  quota 20k) plus sparse `events`.
- The web app fetches history as bounded one-shot queries; the only Firestore
  listener is the low-volume events list.
- Email/password auth only (phone auth is billed).

## Design language

Derived from `Design_taste.docx` (9 reference images): near-black dotted-grid
canvas with raised hairline surfaces (dark, default) / warm-grey canvas with
white r18 cards (light); oversized stat numerals that recede in colour;
DM Mono for units, timestamps, phase tags; accents used as small pops only
(blue/green/amber/red + rare magenta); bespoke charts — soft-fill area with a
dark dot-leader tooltip, tick-mark semicircular gauge, segmented phase bars,
thin donut; one blackletter accent on the login wordmark. Chart palettes are
validated per theme (OKLCH lightness band, CVD separation, WCAG contrast).

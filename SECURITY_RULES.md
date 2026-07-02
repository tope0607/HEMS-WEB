# HEMS Security Rules — what each rule does and why

Roles are enforced **at the database**, not in the UI. The UI hiding a button
is cosmetics; these rules are the actual lock.

## How roles work here

The design doc says `/control` writes should check `users/{uid}.role ==
"admin"`. `/control` lives in the **Realtime Database**, but `users/` lives in
**Firestore** — and RTDB rules cannot read Firestore documents. So the role is
carried where *both* databases can see it: as a **custom claim** on the
Firebase Auth ID token (`role: "admin" | "user" | "device"`).

- Custom claims can only be set by the Admin SDK (`scripts/seed.mjs`) or the
  Firebase console — never by a client. That satisfies "role is NOT
  self-writable".
- `users/{uid}` docs still exist as the readable mirror the web app uses for
  role-based routing, and they are completely client-read-only.
- A crafted request from a "user" account fails at the database because their
  token simply does not carry `role: "admin"`, no matter what the request body
  claims.

Run `npm run test:rules` to see these properties proven against the emulators.

## Realtime Database (`database.rules.json`)

| Path | Read | Write |
|---|---|---|
| `/` (everything else) | denied | denied |
| `/live` | any signed-in account | **device account only** (`auth.token.role === 'device'`) |
| `/control` | any signed-in account | — |
| `/control/contactor` | (inherited) | **admins only** (`auth.token.role === 'admin'`) |

Details:

- **Default deny at the root.** Anything not explicitly opened stays closed.
- **`/live` write = device only.** The ESP32 signs in as the device account
  and overwrites this node every 5 s (including `contactorState` confirmation
  and the `onDisconnect` flip of `deviceOnline`). A web user — admin included —
  cannot spoof telemetry.
- **`/control/contactor` write = admin only**, and `.validate` pins the shape:
  - exactly `{state, requestedBy, requestedAt}` (extra keys rejected via
    `$other: validate false`),
  - `state` must be the number `0` or `1`,
  - `requestedBy` must equal the **caller's own uid** — an admin cannot forge a
    request in someone else's name,
  - `requestedAt` must be a number (epoch ms).
- **`/control` read = any signed-in account** so every dashboard can show a
  pending command, but only admins can create one.

## Firestore (`firestore.rules`)

| Collection | Read | Create | Update / Delete |
|---|---|---|---|
| `history/` | any signed-in account | **device only**, schema-checked | denied |
| `events/` | any signed-in account | **device only**, schema-checked | denied |
| `users/{uid}` | own doc; admins read all | denied | denied |
| everything else | denied | denied | denied |

Details:

- **`history/` and `events/` are append-only.** The device account creates
  them; nobody — not even an admin — can edit or delete telemetry from a
  client. Creates are lightly schema-checked (`ts` must be an integer epoch-ms;
  `events.type` must be `appliance` or `high_load`) so a compromised device
  credential still can't dump arbitrary shapes.
- **`users/{uid}` has no client write path at all.** Not create, not update,
  not delete. Roles change only through the Admin SDK / console, which bypass
  rules by design. This is the anti-privilege-escalation guarantee: the device
  account (or a user) attempting to grant itself `admin` is denied at the
  database.
- **Read scoping:** a user can `get` their own doc (the app reads it once at
  login to route by role); only admins can `get` others' docs or `list` the
  collection.

## Free-tier posture baked into the rules

- The 5-second live stream only ever touches RTDB (`/live` is overwritten, not
  appended) — RTDB is not metered per read on Spark.
- Firestore only receives the 60-second downsampled `history` doc and sparse
  `events` docs: ≈1,440 + a handful of writes/day, far under the 20k/day quota.
- No rule enables collection-wide fan-out reads for unauthenticated visitors;
  everything requires auth, keeping abuse (and read quota burn) out.

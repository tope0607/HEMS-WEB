/**
 * HEMS security-rules tests. Run with:  npm run test:rules
 * (wraps `firebase emulators:exec` so the Auth/RTDB/Firestore emulators are up)
 *
 * These encode the Phase-1 checkpoint guarantees:
 *   1. a "user" account CANNOT write /control (contactor) — even with a
 *      perfectly crafted payload;
 *   2. the device account CANNOT change roles (users/{uid}) — no client can;
 *   3. only the device account can write /live, history/, events/;
 *   4. reads are open to signed-in accounts only.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} from '@firebase/rules-unit-testing';
import { ref, set, get, update } from 'firebase/database';
import { doc, setDoc, getDoc, updateDoc, addDoc, collection } from 'firebase/firestore';

let env;

const ADMIN = { uid: 'admin-uid', claims: { role: 'admin' } };
const USER = { uid: 'user-uid', claims: { role: 'user' } };
const DEVICE = { uid: 'device-uid', claims: { role: 'device' } };

const rtdb = (who) =>
  who
    ? env.authenticatedContext(who.uid, who.claims).database()
    : env.unauthenticatedContext().database();
const fs = (who) =>
  who
    ? env.authenticatedContext(who.uid, who.claims).firestore()
    : env.unauthenticatedContext().firestore();

const contactorCmd = (who, state = 0) => ({
  state,
  requestedBy: who.uid,
  requestedAt: Date.now(),
});

const livePayload = () => ({
  totalPowerW: 2450,
  phases: {
    L1: { p: 900, v: 231.2, i: 4.1, pf: 0.95 },
    L2: { p: 800, v: 229.8, i: 3.7, pf: 0.92 },
    L3: { p: 750, v: 230.5, i: 3.4, pf: 0.9 },
  },
  dailyKwh: 6.4,
  costNaira: 435.2,
  applianceLabel: 'Kettle ON (94%)',
  contactorState: 1,
  highLoad: false,
  lastUpdate: Date.now(),
  deviceOnline: true,
});

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-hems',
    database: { rules: readFileSync('database.rules.json', 'utf8') },
    firestore: { rules: readFileSync('firestore.rules', 'utf8') },
  });
  // users/ docs exist in real life (seed script); create them rules-bypassed
  // so read-scoping tests run against realistic data.
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'users', ADMIN.uid), { email: 'admin@hems.local', role: 'admin' });
    await setDoc(doc(db, 'users', USER.uid), { email: 'user@hems.local', role: 'user' });
    await setDoc(doc(db, 'users', DEVICE.uid), { email: 'device@hems.local', role: 'device' });
  });
});

after(async () => {
  await env.cleanup();
});

// ── The checkpoint pair ──────────────────────────────────────────────────────

test('CHECKPOINT: user account is DENIED writing /control/contactor', async () => {
  await assertFails(set(ref(rtdb(USER), 'control/contactor'), contactorCmd(USER)));
});

test('CHECKPOINT: device account is DENIED changing roles (users/{uid})', async () => {
  // ...its own role:
  await assertFails(
    updateDoc(doc(fs(DEVICE), 'users', DEVICE.uid), { role: 'admin' })
  );
  // ...anyone's role:
  await assertFails(
    updateDoc(doc(fs(DEVICE), 'users', USER.uid), { role: 'admin' })
  );
});

// ── /control ────────────────────────────────────────────────────────────────

test('admin CAN write a well-formed contactor command', async () => {
  await assertSucceeds(set(ref(rtdb(ADMIN), 'control/contactor'), contactorCmd(ADMIN, 0)));
});

test('device and unauthenticated callers are denied /control writes', async () => {
  await assertFails(set(ref(rtdb(DEVICE), 'control/contactor'), contactorCmd(DEVICE)));
  await assertFails(set(ref(rtdb(null), 'control/contactor'), contactorCmd(ADMIN)));
});

test('admin cannot forge requestedBy or malformed state', async () => {
  await assertFails(
    set(ref(rtdb(ADMIN), 'control/contactor'), {
      state: 0,
      requestedBy: 'somebody-else',
      requestedAt: Date.now(),
    })
  );
  await assertFails(
    set(ref(rtdb(ADMIN), 'control/contactor'), {
      state: 2, // only 0|1 allowed
      requestedBy: ADMIN.uid,
      requestedAt: Date.now(),
    })
  );
  await assertFails(
    set(ref(rtdb(ADMIN), 'control/contactor'), {
      ...contactorCmd(ADMIN),
      extraField: 'rejected by $other validate',
    })
  );
});

test('any signed-in account can READ /control; signed-out cannot', async () => {
  await assertSucceeds(get(ref(rtdb(USER), 'control/contactor')));
  await assertFails(get(ref(rtdb(null), 'control/contactor')));
});

// ── /live ───────────────────────────────────────────────────────────────────

test('device CAN overwrite /live; user and admin CANNOT', async () => {
  await assertSucceeds(set(ref(rtdb(DEVICE), 'live'), livePayload()));
  await assertFails(set(ref(rtdb(USER), 'live'), livePayload()));
  await assertFails(update(ref(rtdb(ADMIN), 'live'), { contactorState: 0 }));
});

test('signed-in accounts can read /live; signed-out cannot', async () => {
  await assertSucceeds(get(ref(rtdb(USER), 'live')));
  await assertFails(get(ref(rtdb(null), 'live')));
});

// ── Firestore history/ + events/ ────────────────────────────────────────────

test('device CAN append history; user CANNOT; nobody can edit', async () => {
  const sample = {
    ts: Date.now(),
    avgPowerW: 2400,
    dailyKwh: 6.4,
    costNaira: 435.2,
    phases: { L1: 900, L2: 800, L3: 700 },
  };
  const created = await addDoc(collection(fs(DEVICE), 'history'), sample);
  await assertFails(addDoc(collection(fs(USER), 'history'), sample));
  await assertFails(
    updateDoc(doc(fs(DEVICE), 'history', created.id), { avgPowerW: 9999 })
  );
});

test('device CAN append valid events; bad types are rejected', async () => {
  await assertSucceeds(
    addDoc(collection(fs(DEVICE), 'events'), {
      ts: Date.now(),
      type: 'appliance',
      appliance: 'Kettle',
      event: 'ON',
      powerW: 1800,
    })
  );
  await assertFails(
    addDoc(collection(fs(DEVICE), 'events'), {
      ts: Date.now(),
      type: 'not-a-real-type',
      powerW: 0,
    })
  );
});

// ── users/ role protection ──────────────────────────────────────────────────

test('no client can create, update, or delete users/{uid} — not even admin', async () => {
  await assertFails(
    setDoc(doc(fs(USER), 'users', USER.uid), { role: 'admin' })
  );
  await assertFails(
    updateDoc(doc(fs(USER), 'users', USER.uid), { role: 'admin' })
  );
  await assertFails(
    setDoc(doc(fs(ADMIN), 'users', 'brand-new-uid'), { role: 'admin' })
  );
});

test('users can read their own doc; not others; admin reads all', async () => {
  await assertSucceeds(getDoc(doc(fs(USER), 'users', USER.uid)));
  await assertFails(getDoc(doc(fs(USER), 'users', ADMIN.uid)));
  await assertSucceeds(getDoc(doc(fs(ADMIN), 'users', USER.uid)));
});

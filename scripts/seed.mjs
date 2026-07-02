#!/usr/bin/env node
/**
 * HEMS seed script.
 *
 * Creates the three accounts the system needs and stamps their roles:
 *
 *   admin   — full web app incl. contactor control
 *   user    — web app without controls
 *   device  — the ESP32's identity; the ONLY writer of /live, history/, events/
 *
 * Roles are enforced two ways, both set here and only here:
 *   1. A custom claim on the auth token (`role`) — this is what the security
 *      rules check. RTDB rules cannot read Firestore, so the claim is the
 *      single source of truth both databases can see.
 *   2. A `users/{uid}` Firestore doc — a readable mirror the web app uses to
 *      route by role. Clients cannot write these docs (see firestore.rules).
 *
 * Also writes the initial RTDB shape (/live zeroed, /control/contactor) so
 * the web app renders sanely before the ESP32 first connects.
 *
 * USAGE
 * ─────
 * Against the emulators (no credentials needed):
 *   firebase emulators:start --project demo-hems     # in another terminal
 *   npm run seed:emulator
 *
 * Against a real project (needs a service account key):
 *   export GOOGLE_APPLICATION_CREDENTIALS=./serviceAccountKey.json
 *   export FIREBASE_DATABASE_URL=https://<project>-default-rtdb.firebaseio.com
 *   npm run seed
 *
 * Override any account via env: SEED_ADMIN_EMAIL, SEED_ADMIN_PASSWORD,
 * SEED_USER_EMAIL, SEED_USER_PASSWORD, SEED_DEVICE_EMAIL, SEED_DEVICE_PASSWORD.
 * CHANGE THE DEFAULT PASSWORDS before seeding a real project.
 */
import { initializeApp, applicationDefault, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getDatabase } from 'firebase-admin/database';
import { readFileSync, existsSync } from 'node:fs';

// `--emulator` targets locally running emulators on their default ports
// (equivalent to exporting the three *_EMULATOR_HOST variables yourself).
if (process.argv.includes('--emulator')) {
  process.env.FIREBASE_AUTH_EMULATOR_HOST ||= '127.0.0.1:9099';
  process.env.FIRESTORE_EMULATOR_HOST ||= '127.0.0.1:8080';
  process.env.FIREBASE_DATABASE_EMULATOR_HOST ||= '127.0.0.1:9000';
}

const usingEmulators =
  !!process.env.FIREBASE_AUTH_EMULATOR_HOST ||
  !!process.env.FIRESTORE_EMULATOR_HOST ||
  !!process.env.FIREBASE_DATABASE_EMULATOR_HOST;

const projectId =
  process.env.GCLOUD_PROJECT ||
  process.env.FIREBASE_PROJECT_ID ||
  (usingEmulators ? 'demo-hems' : readProjectIdFromFirebaserc());

function readProjectIdFromFirebaserc() {
  try {
    const rc = JSON.parse(readFileSync(new URL('../.firebaserc', import.meta.url), 'utf8'));
    return rc.projects?.default;
  } catch {
    return undefined;
  }
}

if (!projectId || projectId === 'your-firebase-project-id') {
  if (!usingEmulators) {
    console.error(
      'No project configured. Either point .firebaserc at your project, set\n' +
      'FIREBASE_PROJECT_ID, or run against the emulators (npm run seed:emulator).'
    );
    process.exit(1);
  }
}

const databaseURL =
  process.env.FIREBASE_DATABASE_URL ||
  (usingEmulators
    ? `http://${process.env.FIREBASE_DATABASE_EMULATOR_HOST || '127.0.0.1:9000'}?ns=${projectId}-default-rtdb`
    : undefined);

const credentialPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
const app = initializeApp({
  projectId,
  ...(databaseURL ? { databaseURL } : {}),
  ...(!usingEmulators && credentialPath && existsSync(credentialPath)
    ? { credential: cert(JSON.parse(readFileSync(credentialPath, 'utf8'))) }
    : !usingEmulators
      ? { credential: applicationDefault() }
      : {}),
});

const auth = getAuth(app);
const db = getFirestore(app);

const ACCOUNTS = [
  {
    key: 'admin',
    role: 'admin',
    displayName: 'HEMS Admin',
    email: process.env.SEED_ADMIN_EMAIL || 'admin@hems.local',
    password: process.env.SEED_ADMIN_PASSWORD || 'admin-hems-2026',
  },
  {
    key: 'user',
    role: 'user',
    displayName: 'HEMS Resident',
    email: process.env.SEED_USER_EMAIL || 'user@hems.local',
    password: process.env.SEED_USER_PASSWORD || 'user-hems-2026',
  },
  {
    key: 'device',
    role: 'device',
    displayName: 'ESP32 Meter',
    email: process.env.SEED_DEVICE_EMAIL || 'device@hems.local',
    password: process.env.SEED_DEVICE_PASSWORD || 'device-hems-2026',
  },
];

async function upsertAccount({ role, displayName, email, password }) {
  let user;
  try {
    user = await auth.getUserByEmail(email);
    console.log(`  · ${email} exists (uid ${user.uid})`);
  } catch {
    user = await auth.createUser({ email, password, displayName, emailVerified: true });
    console.log(`  · created ${email} (uid ${user.uid})`);
  }

  // The claim the security rules trust. Re-set on every run so drift heals.
  await auth.setCustomUserClaims(user.uid, { role });

  // Readable mirror for the web app (role-based routing). Never client-writable.
  await db.collection('users').doc(user.uid).set(
    {
      email,
      displayName,
      role,
      createdAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  return user;
}

async function seedRtdbShape() {
  const rtdb = getDatabase(app);
  const now = Date.now();
  await rtdb.ref('live').set({
    totalPowerW: 0,
    phases: {
      L1: { p: 0, v: 0, i: 0, pf: 0 },
      L2: { p: 0, v: 0, i: 0, pf: 0 },
      L3: { p: 0, v: 0, i: 0, pf: 0 },
    },
    dailyKwh: 0,
    costNaira: 0,
    applianceLabel: 'Idle',
    contactorState: 1,
    highLoad: false,
    lastUpdate: now,
    deviceOnline: false,
  });
  await rtdb.ref('control/contactor').set({
    state: 1,
    requestedBy: 'seed',
    requestedAt: now,
  });
  console.log('  · wrote initial /live and /control shape');
}

console.log(
  usingEmulators
    ? `Seeding EMULATORS (project ${projectId})`
    : `Seeding LIVE project ${projectId}`
);

for (const account of ACCOUNTS) {
  await upsertAccount(account);
}

try {
  await seedRtdbShape();
} catch (err) {
  console.warn(
    '  ! could not seed RTDB shape (set FIREBASE_DATABASE_URL to enable):',
    err.message
  );
}

console.log('Done. Roles live in custom claims + users/{uid} mirror docs.');
console.log('NOTE: claims apply on next sign-in / token refresh (~1 h max).');
process.exit(0);

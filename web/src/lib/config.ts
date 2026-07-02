/** Central app configuration, sourced from Vite env (.env at repo root). */

const env = import.meta.env;

export const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY as string | undefined,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined,
  databaseURL: env.VITE_FIREBASE_DATABASE_URL as string | undefined,
  projectId: env.VITE_FIREBASE_PROJECT_ID as string | undefined,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET as string | undefined,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID as string | undefined,
  appId: env.VITE_FIREBASE_APP_ID as string | undefined,
};

/** Demo mode: explicitly requested, or Firebase simply not configured yet.
 *  In demo mode the whole app runs on the simulated data source + mock auth,
 *  so every screen is demoable without the ESP32 or a Firebase project. */
export const DEMO_MODE = env.VITE_DEMO === 'true' || !firebaseConfig.apiKey;

/** Building capacity in watts — the gauge's 100 % mark. */
export const CAPACITY_W = Number(env.VITE_CAPACITY_W) > 0 ? Number(env.VITE_CAPACITY_W) : 12000;

/** Display tariff, ₦/kWh. The ESP32 computes the authoritative costNaira. */
export const TARIFF_NAIRA_PER_KWH =
  Number(env.VITE_TARIFF_NAIRA_PER_KWH) > 0 ? Number(env.VITE_TARIFF_NAIRA_PER_KWH) : 68;

/** Above this fraction of capacity the UI treats load as "high" for styling.
 *  The authoritative highLoad flag comes from the device. */
export const HIGH_LOAD_FRACTION = 0.8;

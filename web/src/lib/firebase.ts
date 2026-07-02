import { initializeApp, type FirebaseApp } from 'firebase/app';
import { firebaseConfig } from './config';

let app: FirebaseApp | null = null;

export function getFirebaseApp(): FirebaseApp {
  if (!app) {
    if (!firebaseConfig.apiKey) {
      throw new Error('Firebase is not configured — set the VITE_FIREBASE_* env keys.');
    }
    app = initializeApp(firebaseConfig);
  }
  return app;
}

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { Role, SessionUser } from '../lib/types';
import { DEMO_MODE } from '../lib/config';

interface AuthContextValue {
  user: SessionUser | null;
  /** true while the initial session restore is in flight */
  booting: boolean;
  signIn(email: string, password: string): Promise<void>;
  signOut(): Promise<void>;
  demo: boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/* ── demo auth: two fixed accounts, persisted in localStorage ────────────── */

const DEMO_ACCOUNTS: Record<string, SessionUser> = {
  'admin@demo.hems': {
    uid: 'demo-admin',
    email: 'admin@demo.hems',
    displayName: 'Demo Admin',
    role: 'admin',
  },
  'user@demo.hems': {
    uid: 'demo-user',
    email: 'user@demo.hems',
    displayName: 'Demo Resident',
    role: 'user',
  },
};

const DEMO_KEY = 'hems-demo-session';

/* ── real auth: Firebase email/password + role from users/{uid} mirror ───── */

async function firebaseSignIn(email: string, password: string): Promise<void> {
  const [{ getAuth, signInWithEmailAndPassword }, { getFirebaseApp }] = await Promise.all([
    import('firebase/auth'),
    import('../lib/firebase'),
  ]);
  await signInWithEmailAndPassword(getAuth(getFirebaseApp()), email, password);
}

async function resolveRole(uid: string): Promise<Role> {
  // Primary: the users/{uid} mirror doc (spec: read users/{uid}.role and route).
  try {
    const [{ doc, getDoc, getFirestore }, { getFirebaseApp }] = await Promise.all([
      import('firebase/firestore'),
      import('../lib/firebase'),
    ]);
    const snap = await getDoc(doc(getFirestore(getFirebaseApp()), 'users', uid));
    const role = snap.exists() ? (snap.data().role as Role | undefined) : undefined;
    if (role === 'admin' || role === 'user' || role === 'device') return role;
  } catch {
    /* fall through to the token claim */
  }
  // Fallback: the custom claim the security rules actually enforce.
  try {
    const [{ getAuth }, { getFirebaseApp }] = await Promise.all([
      import('firebase/auth'),
      import('../lib/firebase'),
    ]);
    const tokenResult = await getAuth(getFirebaseApp()).currentUser?.getIdTokenResult();
    const claim = tokenResult?.claims.role;
    if (claim === 'admin' || claim === 'user' || claim === 'device') return claim;
  } catch {
    /* default below */
  }
  return 'user';
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [booting, setBooting] = useState(true);

  useEffect(() => {
    if (DEMO_MODE) {
      try {
        const saved = localStorage.getItem(DEMO_KEY);
        if (saved && DEMO_ACCOUNTS[saved]) setUser(DEMO_ACCOUNTS[saved]);
      } catch {
        /* private mode */
      }
      setBooting(false);
      return;
    }

    let unsub: (() => void) | undefined;
    (async () => {
      const [{ getAuth, onAuthStateChanged }, { getFirebaseApp }] = await Promise.all([
        import('firebase/auth'),
        import('../lib/firebase'),
      ]);
      unsub = onAuthStateChanged(getAuth(getFirebaseApp()), async (fbUser) => {
        if (!fbUser) {
          setUser(null);
          setBooting(false);
          return;
        }
        const role = await resolveRole(fbUser.uid);
        setUser({
          uid: fbUser.uid,
          email: fbUser.email ?? '',
          displayName: fbUser.displayName || fbUser.email?.split('@')[0] || 'User',
          role,
        });
        setBooting(false);
      });
    })();
    return () => unsub?.();
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const cleanEmail = email.trim().toLowerCase();
    if (DEMO_MODE) {
      await new Promise((r) => setTimeout(r, 650)); // let the loading state show
      const account = DEMO_ACCOUNTS[cleanEmail];
      if (!account || password.length < 4) {
        throw new Error('Invalid credentials. Demo accounts: admin@demo.hems or user@demo.hems (any password of 4+ characters).');
      }
      try {
        localStorage.setItem(DEMO_KEY, cleanEmail);
      } catch {
        /* private mode */
      }
      setUser(account);
      return;
    }
    try {
      await firebaseSignIn(cleanEmail, password);
      // onAuthStateChanged completes the session
    } catch (err) {
      throw new Error(mapAuthError(err));
    }
  }, []);

  const signOut = useCallback(async () => {
    if (DEMO_MODE) {
      try {
        localStorage.removeItem(DEMO_KEY);
      } catch {
        /* private mode */
      }
      setUser(null);
      return;
    }
    const [{ getAuth, signOut: fbSignOut }, { getFirebaseApp }] = await Promise.all([
      import('firebase/auth'),
      import('../lib/firebase'),
    ]);
    await fbSignOut(getAuth(getFirebaseApp()));
  }, []);

  const value = useMemo(
    () => ({ user, booting, signIn, signOut, demo: DEMO_MODE }),
    [user, booting, signIn, signOut]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

function mapAuthError(err: unknown): string {
  const code = (err as { code?: string })?.code ?? '';
  switch (code) {
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return 'Email or password is incorrect.';
    case 'auth/too-many-requests':
      return 'Too many attempts — wait a moment, then try again.';
    case 'auth/network-request-failed':
      return 'Network error — check your connection and retry.';
    default:
      return 'Sign-in failed. Please try again.';
  }
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

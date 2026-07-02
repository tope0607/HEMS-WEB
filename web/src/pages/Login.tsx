import { useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { useTheme } from '../theme/ThemeContext';
import { AlertIcon, BoltIcon, MoonIcon, SunIcon } from '../components/Icons';

export function LoginPage() {
  const { user, booting, signIn, demo } = useAuth();
  const { theme, toggle } = useTheme();
  const navigate = useNavigate();
  const location = useLocation();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!booting && user) {
    const dest = (location.state as { from?: string } | null)?.from ?? '/';
    return <Navigate to={dest} replace />;
  }

  const submit = async (e: FormEvent, presetEmail?: string, presetPw?: string) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await signIn(presetEmail ?? email, presetPw ?? password);
      navigate((location.state as { from?: string } | null)?.from ?? '/', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-split">
      <aside className="login-brandside">
        <div className="topbar-brand">
          <span className="brand-glyph" style={{ color: 'var(--amber)' }}>
            <BoltIcon size={15} />
          </span>
          <span className="brand-name">HEMS</span>
          <span className="pill pill--plain brand-tag" style={{ height: 22, fontSize: 11 }}>
            3-PHASE
          </span>
        </div>

        <div>
          {/* the single blackletter accent, used once (image 8) */}
          <div className="login-wordmark">Hems.</div>
          <p style={{ color: 'var(--ink-2)', maxWidth: 380, marginTop: 14, fontSize: 14.5 }}>
            Three-phase home energy — sensed on the wire, classified on-device,
            controlled from anywhere.
          </p>
        </div>

        <div className="login-stats">
          <span className="mono-value">3× PZEM-004T</span>
          <span className="mono-value">·</span>
          <span className="mono-value">ESP32-WROOM-32UE</span>
          <span className="mono-value">·</span>
          <span className="mono-value">NILM ON-DEVICE</span>
        </div>
      </aside>

      <main className="login-formside">
        <div className="login-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 22 }}>
            <div>
              <h1 style={{ fontSize: 22, fontWeight: 650, letterSpacing: '-0.02em' }}>Sign in</h1>
              <p style={{ color: 'var(--ink-2)', fontSize: 13.5, marginTop: 3 }}>
                Use the account your administrator created.
              </p>
            </div>
            <button
              className="icon-btn"
              onClick={toggle}
              aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
            >
              {theme === 'dark' ? <SunIcon size={15} /> : <MoonIcon size={15} />}
            </button>
          </div>

          {error && (
            <div className="form-error" role="alert">
              <span style={{ marginTop: 1 }}>
                <AlertIcon size={14} />
              </span>
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={submit}>
            <label className="field">
              <span className="field-label mono-label">Email</span>
              <input
                type="email"
                autoComplete="email"
                required
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={busy}
              />
            </label>
            <label className="field">
              <span className="field-label mono-label">Password</span>
              <input
                type="password"
                autoComplete="current-password"
                required
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={busy}
              />
            </label>
            <button className="btn btn--primary btn--block" type="submit" disabled={busy} style={{ marginTop: 6 }}>
              {busy && <span className="spinner" />}
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
          </form>

          {demo && (
            <div style={{ marginTop: 18, paddingTop: 16, borderTop: '1px solid var(--hairline)' }}>
              <div className="mono-label" style={{ marginBottom: 10 }}>
                Demo mode — no device connected
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button
                  className="btn btn--ghost-sm"
                  disabled={busy}
                  onClick={(e) => void submit(e, 'admin@demo.hems', 'demo-pass')}
                >
                  Enter as admin
                </button>
                <button
                  className="btn btn--ghost-sm"
                  disabled={busy}
                  onClick={(e) => void submit(e, 'user@demo.hems', 'demo-pass')}
                >
                  Enter as user
                </button>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

import { NavLink } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { useTheme } from '../theme/ThemeContext';
import { BoltIcon, LogoutIcon, MoonIcon, ShieldIcon, SunIcon } from './Icons';
import { fmtRelative } from '../lib/format';
import type { LiveData } from '../lib/types';

/** Connection status: deviceOnline + relative lastUpdate, in DM Mono. */
function ConnPill({ live }: { live: LiveData | null }) {
  const [, force] = useState(0);
  useEffect(() => {
    const t = setInterval(() => force((n) => n + 1), 5000);
    return () => clearInterval(t);
  }, []);

  const online = !!live?.deviceOnline;
  return (
    <span className={`conn-pill${online ? '' : ' is-off'}`} title="ESP32 connection">
      <span className={`conn-dot${online ? ' pill-dot--pulse' : ''}`} />
      {online ? 'LIVE' : 'OFFLINE'}
      {live && (
        <span className="conn-detail">
          {online ? fmtRelative(live.lastUpdate) : `last ${fmtRelative(live.lastUpdate)}`}
        </span>
      )}
    </span>
  );
}

export function TopBar({ live }: { live: LiveData | null }) {
  const { user, signOut } = useAuth();
  const { theme, toggle } = useTheme();

  return (
    <header className="topbar">
      <div className="topbar-brand">
        <span className="brand-glyph" style={{ color: 'var(--amber)' }}>
          <BoltIcon size={15} />
        </span>
        <span className="brand-name">HEMS</span>
        <span className="pill pill--plain brand-tag" style={{ height: 22, fontSize: 11 }}>
          3-PHASE
        </span>
      </div>

      <nav className="topbar-tabs" aria-label="Pages">
        <NavLink to="/" end className={({ isActive }) => `tab${isActive ? ' is-active' : ''}`}>
          Home
        </NavLink>
        <NavLink to="/history" className={({ isActive }) => `tab${isActive ? ' is-active' : ''}`}>
          History
        </NavLink>
      </nav>

      <div className="topbar-right">
        <ConnPill live={live} />
        <button
          className="icon-btn"
          onClick={toggle}
          aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
          title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
        >
          {theme === 'dark' ? <SunIcon size={15} /> : <MoonIcon size={15} />}
        </button>
        {user && (
          <span className="avatar" title={`${user.email} · ${user.role}`}>
            {(user.displayName || user.email)[0]?.toUpperCase()}
            {user.role === 'admin' && (
              <span className="avatar-badge" style={{ color: 'var(--blue)' }}>
                <ShieldIcon size={8} />
              </span>
            )}
          </span>
        )}
        <button className="icon-btn" onClick={() => void signOut()} aria-label="Sign out" title="Sign out">
          <LogoutIcon size={15} />
        </button>
      </div>
    </header>
  );
}

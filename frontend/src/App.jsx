import { useEffect, useRef } from 'react';
import { useAuth } from './auth.jsx';
import { AuthScreen } from './components/AuthScreen.jsx';
import { PatientApp } from './components/PatientApp.jsx';
import { DoctorApp } from './components/DoctorApp.jsx';
import { AdminApp } from './components/AdminApp.jsx';
import { Avatar, Icon } from './components/common.jsx';
import { currentPortal } from './lib/route.js';

const PatientView = PatientApp;
const DoctorView = DoctorApp;
const AdminView = AdminApp;

const portal = currentPortal();
const PORTAL_LABELS = { patient: 'Patient', doctor: 'Doctor', admin: 'Admin' };
const ROLE_NOTES = { staff: ' (doctor)', admin: ' (admin)' };

export default function App() {
  const { user, logout } = useAuth();
  const brandClicksRef = useRef([]);

  useEffect(() => {
    if (user || portal === 'admin') return undefined;
    function onKeyDown(event) {
      if (!event.altKey || !event.shiftKey) return;
      if (event.code !== 'KeyA' && event.key?.toLowerCase() !== 'a') return;
      const target = event.target;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable) return;
      event.preventDefault();
      window.location.assign('/admin');
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [user]);

  function handleBrandClick() {
    if (user || portal === 'admin') return;
    const now = Date.now();
    const recent = brandClicksRef.current.filter(timestamp => now - timestamp <= 3000);
    recent.push(now);
    brandClicksRef.current = recent;
    if (recent.length >= 5) {
      brandClicksRef.current = [];
      window.location.assign('/admin');
    }
  }

  return (
    <>
      <a className="skip-link" href="#main">Skip to main content</a>
      <header className="site-header">
        <div className="site-header-inner">
          <div className="brand">
            <span className="brand-mark" onClick={handleBrandClick}><Icon name="pulse" /></span>
            <h1>Motion Track</h1>
            <p className="portal-label">{PORTAL_LABELS[portal]}</p>
          </div>
          {user && (
            <div className="account account-enter">
              <Avatar name={user.name} />
              <p>Signed in as <strong>{user.name}</strong>{ROLE_NOTES[user.role] ?? ''}</p>
              <button type="button" className="button button-small" onClick={logout}>Sign out</button>
            </div>
          )}
        </div>
      </header>
      <main id="main" tabIndex={-1} className="page">
        <div key={user ? `${user.role}:${user.id}` : `auth:${portal}`} className="page-view">
          {/* Keyed by account so no data survives a change of user. */}
          {!user && <AuthScreen portal={portal} />}
          {user?.role === 'participant' && <PatientView key={user.id} />}
          {user?.role === 'staff' && <DoctorView key={user.id} />}
          {user?.role === 'admin' && <AdminView key={user.id} />}
          {user && !['participant', 'staff', 'admin'].includes(user.role) && (
            <p className="alert alert-error" role="alert">This account type is not supported. Please sign out.</p>
          )}
        </div>
      </main>
    </>
  );
}

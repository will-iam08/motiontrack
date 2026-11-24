import { useLayoutEffect, useState } from 'react';
import { describeError } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Icon, ScreenHeading } from './common.jsx';
import { InteractiveShowcase } from './InteractiveShowcase.jsx';

const PORTALS = {
  patient: {
    eyebrow: 'Patient portal',
    title: 'Your home exercise log',
    lead: 'Review sets synced from the Motion Track iPhone app, follow your doctor’s rep and heart-rate targets, and track your progress.',
    heading: 'Sign in',
    intro: 'Patients sign in here with their email and password.',
    features: [
      { icon: 'heart', title: 'Heart rate before and after', text: 'Take a reading before your first rep and another straight after your last.' },
      { icon: 'device', title: 'Synced from the Motion Track app', text: 'Connect your tracker over Bluetooth in Motion Track, and finished sets upload here automatically.' },
      { icon: 'clipboard', title: 'Shared with your doctor', text: 'Your completed sets, care plan and questions stay in one place for your doctor to review.' },
    ],
  },
  doctor: {
    eyebrow: 'Doctor portal',
    title: 'Review patient rehab sessions',
    lead: 'Check your patients’ completed exercises, follow a session while it happens, update care plans and answer messages.',
    heading: 'Doctor sign-in',
    intro: 'Doctors sign in here with their email and password.',
    features: [
      { icon: 'users', title: 'Your assigned patients', text: 'You see only the patients assigned to you. Their exercise records are read only.' },
      { icon: 'pulse', title: 'Sessions as they happen', text: 'Follow reps and heart-rate readings while a patient is exercising.' },
      { icon: 'clipboard', title: 'Care plans and messages', text: 'Set rep and heart-rate targets, and reply to questions sent from the website or by email.' },
    ],
  },
  admin: {
    eyebrow: 'Admin portal',
    title: 'Clinic administration',
    lead: 'Set up doctor accounts, assign patients to doctors and check activity across the clinic.',
    heading: 'Admin sign-in',
    intro: 'Administrators sign in here with their email and password.',
    features: [
      { icon: 'chart', title: 'Clinic overview', text: 'Patients, doctors, sessions, devices and unread messages on one page.' },
      { icon: 'link', title: 'Patient assignments', text: 'Assign each patient to a doctor, or remove an assignment.' },
      { icon: 'shield', title: 'Doctor accounts', text: 'Create sign-ins for new doctors.' },
    ],
  },
};

function portalRecoveryLink(message) {
  const lower = String(message ?? '').toLowerCase();
  if (lower.includes('doctor')) return { href: '/doctor', label: 'Go to doctor sign-in' };
  if (lower.includes('patient')) return { href: '/', label: 'Go to patient sign-in' };
  if (lower.includes('admin')) return { href: '/admin', label: 'Go to admin sign-in' };
  return null;
}

function jumpToDemo(event) {
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const demo = document.getElementById('interactive-demo');
  if (!demo) return;
  event.preventDefault();
  if (window.location.hash !== '#interactive-demo') {
    window.history.pushState(null, '', '#interactive-demo');
  }
  const motion = window.matchMedia('(prefers-reduced-motion: no-preference)').matches;
  demo.focus({ preventScroll: true });
  demo.scrollIntoView({ behavior: motion ? 'smooth' : 'auto' });
}

export function AuthScreen({ portal = 'patient' }) {
  const copy = PORTALS[portal] ?? PORTALS.patient;
  const patient = portal === 'patient';
  const { login, register, notice } = useAuth();
  const [mode, setMode] = useState('login');
  const [hasSwitchedMode, setHasSwitchedMode] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [invalidField, setInvalidField] = useState(null);
  const [wrongPortal, setWrongPortal] = useState(null);
  const registering = patient && mode === 'register';

  useLayoutEffect(() => {
    if (patient && window.location.hash === '#interactive-demo') {
      document.getElementById('interactive-demo')?.scrollIntoView();
    }
  }, [patient]);

  function switchMode(next) {
    setMode(next);
    setHasSwitchedMode(true);
    setError('');
    setInvalidField(null);
    setWrongPortal(null);
    setPassword('');
    setShowPassword(false);
  }

  async function onSubmit(event) {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget;
    function showFieldError(field, message) {
      setInvalidField(field);
      setError(message);
      form.elements.namedItem(field)?.focus();
    }
    setWrongPortal(null);
    if (registering && (!name.trim() || name.trim().length > 80)) {
      return showFieldError('name', 'Enter your name (up to 80 characters).');
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      return showFieldError('email', 'Enter a valid email address, for example name@example.com.');
    }
    if (password.length < 12 || password.length > 128) {
      return showFieldError('password', 'Your password must be 12 to 128 characters long.');
    }
    setInvalidField(null);
    setBusy(true);
    setError('');
    try {
      if (registering) await register(name.trim(), email.trim(), password);
      else await login(email.trim(), password, portal);
    } catch (failure) {
      if (failure.status === 403 && failure.message) {
        setError(failure.message);
        setWrongPortal(portalRecoveryLink(failure.message));
      } else if (failure.status === 401) {
        setError('That email or password is not correct. Please try again.');
      } else if (failure.status === 409) {
        setError('An account with this email already exists. Sign in instead.');
      } else {
        setError(describeError(failure));
      }
      setBusy(false);
    }
    return undefined;
  }

  return (
    <>
      <div className="auth-shell">
        <div className="auth-aside">
          <p className="auth-eyebrow"><Icon name={portal === 'admin' ? 'shield' : 'pulse'} />{copy.eyebrow}</p>
          <p className="auth-title">{copy.title}</p>
          <p className="auth-lead">{copy.lead}</p>
          <ul className="feature-list">
            {copy.features.map(feature => (
              <li key={feature.title}>
                <span className="feature-icon"><Icon name={feature.icon} /></span>
                <span><strong>{feature.title}</strong><span className="hint block">{feature.text}</span></span>
              </li>
            ))}
          </ul>
          {patient && (
            <div className="hero-actions">
              <a className="button hero-demo-link" href="#interactive-demo" onClick={jumpToDemo}>
                <Icon name="play" />Try the wrist-sensor demo
              </a>
            </div>
          )}
        </div>
        <section className="card auth-card" aria-labelledby="auth-heading">
          {notice && <p className="alert alert-info" role="status">{notice}</p>}
          <div key={mode} className={hasSwitchedMode ? 'auth-form-switch' : undefined}>
            <div id="auth-heading">
              <ScreenHeading level={2} key={mode} autoFocus={hasSwitchedMode}>{registering ? 'Create your account' : copy.heading}</ScreenHeading>
            </div>
            <p>
              {registering ? 'Create a patient account to record your movement exercises.' : copy.intro}
            </p>
            <form onSubmit={onSubmit} noValidate>
              {registering && (
                <div className="field">
                <label htmlFor="auth-name">Your name</label>
                <input
                  id="auth-name"
                  name="name"
                  type="text"
                  autoComplete="name"
                  maxLength={80}
                  value={name}
                  onChange={e => { setName(e.target.value); if (invalidField === 'name') setInvalidField(null); }}
                  aria-invalid={invalidField === 'name' ? true : undefined}
                  aria-describedby={invalidField === 'name' && error ? 'auth-error' : undefined}
                  required
                />
              </div>
            )}
            <div className="field">
              <label htmlFor="auth-email">Email address</label>
              <input
                id="auth-email"
                name="email"
                type="email"
                autoComplete="email"
                spellCheck={false}
                maxLength={254}
                value={email}
                onChange={e => { setEmail(e.target.value); if (invalidField === 'email') setInvalidField(null); }}
                aria-invalid={invalidField === 'email' ? true : undefined}
                aria-describedby={invalidField === 'email' && error ? 'auth-error' : undefined}
                required
              />
            </div>
            <div className="field">
              <label htmlFor="auth-password">Password</label>
              <div className="password-row">
                <input
                  id="auth-password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete={registering ? 'new-password' : 'current-password'}
                  maxLength={128}
                  value={password}
                  onChange={e => { setPassword(e.target.value); if (invalidField === 'password') setInvalidField(null); }}
                  aria-invalid={invalidField === 'password' ? true : undefined}
                  aria-describedby={invalidField === 'password' && error ? 'auth-password-hint auth-error' : 'auth-password-hint'}
                  required
                />
                <button
                  type="button"
                  className="button button-small password-toggle"
                  aria-pressed={showPassword}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  onClick={() => setShowPassword(visible => !visible)}
                >
                  <Icon name={showPassword ? 'eyeOff' : 'eye'} />
                  <span>{showPassword ? 'Hide' : 'Show'}</span>
                </button>
              </div>
              <p className="hint" id="auth-password-hint">Passwords are 12 to 128 characters long.</p>
            </div>
            {error && (
              <p id="auth-error" className="alert alert-error" role="alert">
                <span aria-hidden="true">⚠ </span>{error}
                {wrongPortal && (
                  <> <a href={wrongPortal.href}>{wrongPortal.label}</a></>
                )}
              </p>
            )}
            <button type="submit" className="button button-primary button-wide" disabled={busy}>
              {busy ? 'Please wait…' : registering ? 'Create account' : 'Sign in'}
            </button>
          </form>
          </div>
          {patient && (
            <p className="switch-mode">
              {registering ? 'Already have an account?' : 'New patient?'}{' '}
              <button type="button" className="button button-link" onClick={() => switchMode(registering ? 'login' : 'register')}>
                {registering ? 'Sign in instead' : 'Create an account'}
              </button>
            </p>
          )}
          <div className="auth-footer">
            <p className="switch-mode portal-links">
              {portal !== 'patient' && <a className="portal-link" href="/"><Icon name="user" />Patient sign-in</a>}
              {portal !== 'doctor' && <a className="portal-link" href="/doctor"><Icon name="users" />Doctor sign-in</a>}
            </p>
            <p className="hint"><Icon name="lock" /> For your privacy you are signed out when this page is closed or reloaded.</p>
          </div>
        </section>
      </div>
      {patient && <InteractiveShowcase />}
    </>
  );
}

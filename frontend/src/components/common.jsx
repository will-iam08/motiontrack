import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { describeError } from '../api.js';
import { STATUS_LABELS } from '../lib/format.js';

// Line icons, drawn on a 24px grid with the current text colour. They are
// always decorative: the text next to them carries the meaning.
const ICON_PATHS = {
  volume: 'M4 9.5h3.5L12 5.5v13l-4.5-4H4zM15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11',
  volumeOff: 'M4 9.5h3.5L12 5.5v13l-4.5-4H4zM16 9.5l5 5M21 9.5l-5 5',
  search: 'M10.5 4a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zM15.5 15.5L20 20',
  download: 'M12 4v11M7.5 10.5L12 15l4.5-4.5M5 19.5h14',
  printer: 'M7 9V4h10v5M7 17H5a1 1 0 0 1-1-1v-5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v5a1 1 0 0 1-1 1h-2M8 14h8v6H8z',
  copy: 'M9 9h10v10H9zM5 15V5h10',
  pulse: 'M3 12h4l2.5-6 4 12 2.5-6H21',
  heart: 'M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  cross: 'M6 6l12 12M18 6L6 18',
  alert: 'M12 4l9 16H3L12 4zM12 10v4M12 17.5v.5',
  info: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 11v6M12 7.5v.5',
  clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5l3 2',
  device: 'M8 3h8a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM11 18h2',
  signal: 'M5 12.5a10 10 0 0 1 14 0M8 15.5a5.5 5.5 0 0 1 8 0M12 19h.01',
  wifiOff: 'M3 3l18 18M8.5 15.5a5 5 0 0 1 6.2-.6M5 12a10 10 0 0 1 4-2.4M19 12a10 10 0 0 0-5.5-2.7M12 19h.01',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0',
  users: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21a7 7 0 0 1 14 0M16 3.5a4 4 0 0 1 0 7.5M18 14a6 6 0 0 1 4 7',
  lock: 'M6 11h12v10H6zM8.5 11V8a3.5 3.5 0 0 1 7 0v3',
  history: 'M3 12a9 9 0 1 0 3-6.7M3 4v4h4M12 8v4l3 2',
  chart: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  play: 'M8 5v14l11-7z',
  dumbbell: 'M6 7v10M3 9.5v5M18 7v10M21 9.5v5M6 12h12',
  arrowLeft: 'M19 12H5M11 6l-6 6 6 6',
  target: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10zM12 11v2',
  mail: 'M3 6h18v12H3zM3 7l9 6 9-6',
  send: 'M21 3L10 14M21 3l-7 18-4-7-7-4z',
  shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z',
  clipboard: 'M9 4h6v3H9zM7 5.5H5V21h14V5.5h-2M8.5 12h7M8.5 16h5',
  plus: 'M12 5v14M5 12h14',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  minus: 'M5 12h14',
  eye: 'M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
  eyeOff: 'M3 3l18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M9.9 5.2A10.6 10.6 0 0 1 12 5c6.4 0 10 7 10 7a16.8 16.8 0 0 1-3.2 4.3M6.6 6.6C4 8.3 2 12 2 12s3.6 6.5 10 6.5a10 10 0 0 0 4-.8',
};

export function Icon({ name, className = 'icon' }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d={ICON_PATHS[name]} />
    </svg>
  );
}

// Two initials from a name, for the round avatar beside a person.
export function initials(name) {
  const parts = String(name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

export function Avatar({ name }) {
  return <span className="avatar" aria-hidden="true">{initials(name)}</span>;
}

export function ErrorMessage({ error, onRetry }) {
  if (!error) return null;
  return (
    <div className="alert alert-error" role="alert">
      <p><span aria-hidden="true">⚠ </span>{typeof error === 'string' ? error : describeError(error)}</p>
      {onRetry && <button type="button" className="button" onClick={onRetry}>Try again</button>}
    </div>
  );
}

export function Loading({ label = 'Loading…' }) {
  return <p className="loading" role="status">{label}</p>;
}

const STATUS_ICONS = { pending: 'clock', active: 'play', completed: 'check', cancelled: 'cross', incomplete: 'alert' };

// `label` overrides the default wording (rep exercises use their own labels).
export function StatusBadge({ status, label }) {
  return (
    <span className={`badge badge-${status}`}>
      {STATUS_ICONS[status] && <Icon name={STATUS_ICONS[status]} />}
      {label ?? STATUS_LABELS[status] ?? status}
    </span>
  );
}

// "Live now" with a pulsing dot (the dot is still when reduced motion is set).
export function LiveBadge({ label = 'Live now' }) {
  return (
    <span className="badge badge-live">
      <span className="pulse" aria-hidden="true" />
      {label}
    </span>
  );
}

// A heading that takes keyboard focus when its screen appears, so keyboard and
// screen-reader users land at the start of the new content.
export function ScreenHeading({ level = 2, autoFocus = true, children }) {
  const ref = useRef(null);
  useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, [autoFocus]);
  const Tag = `h${level}`;
  return <Tag ref={ref} tabIndex={-1} className="screen-heading">{children}</Tag>;
}

// Newer/older buttons for a paged list (hidden when there is only one page).
export function Pager({ data, page, pageSize, itemCount, onPage, label }) {
  const total = data.total;
  const first = total === 0 ? 0 : data.offset + 1;
  const last = total === 0 ? 0 : data.offset + itemCount;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  if (pageCount <= 1) return null;
  return (
    <nav className="pager" aria-label={label}>
      <button type="button" className="button" disabled={page === 0} onClick={() => onPage(page - 1)}>← Newer</button>
      <p role="status">Showing {first}–{last} of {total} (page {page + 1} of {pageCount})</p>
      <button type="button" className="button" disabled={last >= total} onClick={() => onPage(page + 1)}>Older →</button>
    </nav>
  );
}

const CHECK_STYLES = {
  met: { badge: 'completed', icon: 'check', word: 'Met' },
  in: { badge: 'completed', icon: 'check', word: 'In range' },
  below: { badge: 'incomplete', icon: 'alert', word: 'Below' },
  above: { badge: 'incomplete', icon: 'alert', word: 'Above' },
  none: { badge: 'cancelled', icon: 'minus', word: 'No reading' },
  pending: { badge: 'pending', icon: 'clock', word: 'Not yet' },
};

// How one exercise compares with the care plan: a short badge word plus the
// full sentence, so the result never depends on colour.
export function PlanCheck({ check }) {
  if (!check) return null;
  const style = CHECK_STYLES[check.state] ?? CHECK_STYLES.pending;
  return (
    <span className="plan-check">
      <span className={`badge badge-${style.badge}`}><Icon name={style.icon} />{style.word}</span>
      <span className="visually-hidden">: </span>
      <span className="plan-check-text">{check.label}</span>
    </span>
  );
}

// Section tabs with an indicator that slides to the current tab. The current
// tab is still marked with aria-current and a solid outline before the
// indicator has been measured, so nothing depends on the animation.
export function TabNav({ views, current, onChange, label }) {
  const navRef = useRef(null);
  const [box, setBox] = useState(null);
  const badgeKey = views.map(item => `${item.id}:${item.badge ?? 0}`).join('|');

  useLayoutEffect(() => {
    const nav = navRef.current;
    if (!nav) return undefined;
    function measure() {
      const active = nav.querySelector('[aria-current="page"]');
      if (!active) return setBox(null);
      return setBox({ x: active.offsetLeft, y: active.offsetTop, w: active.offsetWidth, h: active.offsetHeight });
    }
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(nav);
    return () => observer.disconnect();
  }, [current, badgeKey]);

  const style = box
    ? { '--indicator-x': `${box.x}px`, '--indicator-y': `${box.y}px`, '--indicator-w': `${box.w}px`, '--indicator-h': `${box.h}px`, '--indicator-opacity': 1 }
    : undefined;

  return (
    <nav ref={navRef} className={box ? 'nav nav-measured' : 'nav'} aria-label={label} style={style}>
      <span className="nav-indicator" aria-hidden="true" />
      {views.map(item => (
        <button key={item.id} type="button" className="nav-button" aria-current={current === item.id ? 'page' : undefined} onClick={() => onChange(item.id)}>
          <Icon name={item.icon} />
          {item.label}
          {item.badge > 0 && (
            <>
              <span className="chip-count" aria-hidden="true">{item.badge}</span>
              <span className="visually-hidden"> ({item.badgeLabel ?? `${item.badge} new`})</span>
            </>
          )}
        </button>
      ))}
    </nav>
  );
}

// Quick filters as toggle buttons in a labelled group. Each chip says how many
// items it would show, so a filter never hides things silently.
export function FilterChips({ label, options, value, onChange, counts }) {
  return (
    <div className="chips" role="group" aria-label={label}>
      {options.map(option => (
        <button
          key={option.id}
          type="button"
          className="chip"
          aria-pressed={value === option.id}
          onClick={() => onChange(option.id)}
        >
          {option.icon && <Icon name={option.icon} />}
          {option.label}
          {counts && counts[option.id] !== undefined && <span className="chip-count">{counts[option.id]}</span>}
        </button>
      ))}
    </div>
  );
}

// A labelled search box (the label is visually hidden; the placeholder is not a label).
export function SearchField({ id, label, value, onChange, placeholder }) {
  return (
    <div className="search-field">
      <label htmlFor={id} className="visually-hidden">{label}</label>
      <Icon name="search" />
      <input id={id} type="search" value={value} placeholder={placeholder} onChange={event => onChange(event.target.value)} autoComplete="off" />
    </div>
  );
}

// Copies text and confirms in words (and to screen readers). If the browser
// blocks the clipboard, it says so instead of failing silently.
export function CopyButton({ text, label = 'Copy', copiedLabel = 'Copied' }) {
  const [state, setState] = useState('idle');
  useEffect(() => {
    if (state === 'idle') return undefined;
    const timer = setTimeout(() => setState('idle'), 2500);
    return () => clearTimeout(timer);
  }, [state]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setState('copied');
    } catch {
      setState('failed');
    }
  }

  return (
    <span className="copy-row">
      <button type="button" className="button button-small" onClick={copy}>
        <Icon name={state === 'copied' ? 'check' : 'copy'} />{state === 'copied' ? copiedLabel : label}
      </button>
      <span role="status" className={state === 'copied' ? 'copy-done' : 'hint'}>
        {state === 'copied' && `${copiedLabel} to your clipboard.`}
        {state === 'failed' && 'Copying is blocked here. Select the address and copy it by hand.'}
      </span>
    </span>
  );
}

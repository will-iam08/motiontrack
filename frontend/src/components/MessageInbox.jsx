import { useCallback, useEffect, useState } from 'react';
import { describeError } from '../api.js';
import { useAuth } from '../auth.jsx';
import { formatDateTime } from '../lib/format.js';
import { chipCounts, filterMessages } from '../lib/filters.js';
import { BODY_MAX, parseReply, sourceLabel, unreadText } from '../lib/messages.js';
import { Avatar, ErrorMessage, FilterChips, Icon, LiveBadge, Loading, SearchField } from './common.jsx';

const REFRESH_MS = 10000;
const MAX_BACKOFF_MS = 30000;
const PAGE = 10;

export function InboxMessage({ message, onChanged, onOpenPatient }) {
  const { api } = useAuth();
  const [replyOpen, setReplyOpen] = useState(false);
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const replyId = `reply-${message.id}`;
  const errorId = `reply-error-${message.id}`;

  async function update(body, what) {
    setBusy(what);
    setError('');
    try {
      const data = await api(`/api/doctor/messages/${message.id}`, { method: 'PATCH', body });
      onChanged(data.message);
      return true;
    } catch (failure) {
      if (failure.status !== 401) setError(describeError(failure));
      return false;
    } finally {
      setBusy('');
    }
  }

  async function sendReply(event) {
    event.preventDefault();
    const parsed = parseReply(reply);
    if (parsed.error) return setError(parsed.error);
    if (await update({ doctor_reply: parsed.reply }, 'reply')) {
      setReply('');
      setReplyOpen(false);
    }
    return undefined;
  }

  return (
    <li className={message.is_read ? 'message' : 'message message-unread'}>
      <div className="message-head">
        <span className="person">
          <Avatar name={message.participant_name} />
          <span className="person-text">
            <strong className="block">{message.participant_name}</strong>
            <span className="hint block">{message.participant_email}</span>
          </span>
        </span>
        <span className="message-badges">
          {message.is_read
            ? <span className="badge badge-readonly"><Icon name="check" />Read</span>
            : <span className="badge badge-active"><Icon name="mail" />New</span>}
          {message.active_session_id && <LiveBadge label="Exercising now" />}
        </span>
      </div>
      <h4 className="message-subject">{message.subject}</h4>
      <p className="hint">Received {formatDateTime(message.received_at)} · {sourceLabel(message.source)}</p>
      <p className="message-body">{message.body}</p>
      {message.doctor_reply && (
        <div className="message-reply">
          <p className="eyebrow">Reply{message.replied_by_name ? ` from ${message.replied_by_name}` : ''} · {formatDateTime(message.replied_at)}</p>
          <p className="message-body">{message.doctor_reply}</p>
        </div>
      )}
      <div className="reply-form">
        <div className="button-row">
          <button
            type="button"
            className="button button-small"
            aria-expanded={replyOpen}
            aria-controls={replyOpen ? `${replyId}-form` : undefined}
            onClick={() => { setReplyOpen(open => !open); setError(''); }}
          >
            <Icon name="send" />{message.doctor_reply ? 'Edit reply' : 'Reply'}
          </button>
          <button type="button" className="button button-small" disabled={Boolean(busy)}
            onClick={() => update({ is_read: !message.is_read }, 'read')}
            aria-label={`${message.is_read ? 'Mark as unread' : 'Mark as read'}: ${message.subject} from ${message.participant_name}`}>
            {message.is_read ? 'Mark as unread' : 'Mark as read'}
          </button>
          {onOpenPatient && (
            <button type="button" className="button button-small button-quiet" onClick={() => onOpenPatient(message.participant_id)}
              aria-label={`Open the patient record for ${message.participant_name}`}>
              <Icon name="user" />Open patient record
            </button>
          )}
        </div>
        {!replyOpen && error && <ErrorMessage error={error} />}
        {replyOpen && (
          <form id={`${replyId}-form`} onSubmit={sendReply} noValidate className="reply-editor">
            {message.doctor_reply && (
              <p className="hint" id={`${replyId}-replace-hint`}>
                Sending a new reply replaces the previous reply shown above.
              </p>
            )}
            <div className="field">
              <label htmlFor={replyId}>{message.doctor_reply ? 'New reply' : 'Reply'} to {message.participant_name}</label>
              <textarea
                id={replyId}
                rows={3}
                maxLength={BODY_MAX}
                value={reply}
                onChange={e => { setReply(e.target.value); if (error) setError(''); }}
                aria-invalid={error ? true : undefined}
                aria-describedby={[
                  message.doctor_reply ? `${replyId}-replace-hint` : '',
                  error ? errorId : '',
                ].filter(Boolean).join(' ') || undefined}
              />
            </div>
            {error && <div id={errorId}><ErrorMessage error={error} /></div>}
            <div className="button-row">
              <button type="submit" className="button button-primary button-small" disabled={Boolean(busy)}>
                <Icon name="send" />{busy === 'reply' ? 'Sending…' : 'Send reply'}
              </button>
              <button
                type="button"
                className="button button-small button-quiet"
                disabled={Boolean(busy)}
                onClick={() => { setReplyOpen(false); setError(''); }}
              >
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>
    </li>
  );
}

// "Patient Message Inbox" at the top of the doctor dashboard: questions from
// the doctor's assigned patients, sent from the website or by email.
export function MessageInbox({ onOpenPatient }) {
  const { api } = useAuth();
  const [chip, setChip] = useState('all');
  const [query, setQuery] = useState('');
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [shown, setShown] = useState(PAGE);
  const [tick, setTick] = useState(0);

  const refresh = useCallback(() => setTick(n => n + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    let stopped = false;
    let timer;
    let failCount = 0;
    (async () => {
      while (!stopped) {
        let waitMs = REFRESH_MS;
        try {
          const result = await api('/api/doctor/messages', { query: { unread_only: 0 }, signal: controller.signal });
          if (stopped) return;
          failCount = 0;
          setData(result);
          setError(null);
        } catch (failure) {
          if (stopped || failure?.name === 'AbortError' || failure?.status === 401) return;
          setError(failure);
          if (failure.status !== 0 && failure.status !== 429 && failure.status < 500) return;
          failCount += 1;
          waitMs = Math.min(MAX_BACKOFF_MS, REFRESH_MS * (2 ** Math.min(failCount, 3)));
        }
        await new Promise(resolve => { timer = setTimeout(resolve, waitMs); });
      }
    })();
    return () => {
      stopped = true;
      controller.abort();
      clearTimeout(timer);
    };
  }, [api, tick]);

  function changed(message) {
    setData(previous => {
      if (!previous) return previous;
      const nextMessages = previous.messages.map(item => (item.id === message.id ? { ...item, ...message } : item));
      return {
        ...previous,
        messages: nextMessages,
        unread_count: nextMessages.filter(item => !item.is_read).length,
      };
    });
  }

  const unread = data?.unread_count ?? 0;
  const allMessages = data?.messages ?? [];
  const searched = filterMessages(allMessages, { query });
  const messages = filterMessages(searched, { chip });
  const counts = chipCounts(searched, ['all', 'unread', 'email', 'portal'], (items, id) => filterMessages(items, { chip: id }));
  const pick = next => { setChip(next); setShown(PAGE); };

  return (
    <section className="card inbox" aria-labelledby="inbox-heading">
      <div className="console-head">
        <h2 id="inbox-heading" className="inbox-title"><Icon name="mail" />Patient Message Inbox</h2>
        <span className={unread ? 'badge badge-active' : 'badge badge-readonly'} aria-live="polite">
          {unread ? <Icon name="mail" /> : <Icon name="check" />}{unreadText(unread)}
        </span>
      </div>
      <p>Questions from your assigned patients, sent from the website or by email.</p>
      {allMessages.length > 0 && (
        <div className="toolbar">
          <SearchField id="inbox-search" label="Search messages" placeholder="Search messages" value={query} onChange={value => { setQuery(value); setShown(PAGE); }} />
          <FilterChips
            label="Show messages"
            value={chip}
            onChange={pick}
            counts={counts}
            options={[
              { id: 'all', label: 'All' },
              { id: 'unread', label: 'Unread', icon: 'mail' },
              { id: 'email', label: 'By email' },
              { id: 'portal', label: 'From website' },
            ]}
          />
        </div>
      )}
      {error && data && (
        <p className="alert alert-warning" role="status">
          <span aria-hidden="true">⚠ </span><strong>Could not refresh the inbox.</strong> Trying again automatically.
        </p>
      )}
      {error && !data && <ErrorMessage error={error} onRetry={refresh} />}
      {!data && !error && <Loading label="Loading your messages…" />}
      {data && allMessages.length === 0 && <p className="empty">No messages from your patients yet.</p>}
      {data && allMessages.length > 0 && messages.length === 0 && (
        <p className="empty">
          No messages match. <button type="button" className="button button-link" onClick={() => { pick('all'); setQuery(''); }}>Show all messages</button>
        </p>
      )}
      {messages.length > 0 && (
        <ul className="list message-list" aria-label="Patient messages">
          {messages.slice(0, shown).map(message => (
            <InboxMessage key={message.id} message={message} onChanged={changed} onOpenPatient={onOpenPatient} />
          ))}
        </ul>
      )}
      {messages.length > shown && (
        <button type="button" className="button" onClick={() => setShown(n => n + PAGE)}>
          Show {Math.min(PAGE, messages.length - shown)} more of {messages.length - shown} older messages
        </button>
      )}
    </section>
  );
}

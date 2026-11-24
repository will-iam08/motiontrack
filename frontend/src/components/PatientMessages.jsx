import { useCallback, useEffect, useState } from 'react';
import { describeError } from '../api.js';
import { useAuth } from '../auth.jsx';
import { formatDateTime } from '../lib/format.js';
import { BODY_MAX, SUBJECT_MAX, parseQuestion, sourceLabel } from '../lib/messages.js';
import { CopyButton, ErrorMessage, Icon, Loading, ScreenHeading } from './common.jsx';

const REFRESH_MS = 15000;

function AskForm({ onSent }) {
  const { api } = useAuth();
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [invalidField, setInvalidField] = useState(null);
  const [sent, setSent] = useState('');

  async function onSubmit(event) {
    event.preventDefault();
    const parsed = parseQuestion({ subject, body });
    if (parsed.error) {
      setInvalidField(/subject/i.test(parsed.error) ? 'subject' : 'body');
      return setError(parsed.error);
    }
    setBusy(true);
    setError('');
    setInvalidField(null);
    setSent('');
    try {
      await api('/api/messages', { method: 'POST', body: parsed.body });
      setSubject('');
      setBody('');
      setSent('Your question was sent to your doctor.');
      onSent();
    } catch (failure) {
      if (failure.status !== 401) setError(describeError(failure));
    } finally {
      setBusy(false);
    }
    return undefined;
  }

  const subjectError = invalidField === 'subject';
  const bodyError = invalidField === 'body';

  return (
    <form onSubmit={onSubmit} noValidate className="message-form">
      <div className="field">
        <label htmlFor="question-subject">Subject (optional)</label>
        <input
          id="question-subject"
          type="text"
          maxLength={SUBJECT_MAX}
          value={subject}
          onChange={e => {
            setSubject(e.target.value);
            setSent('');
            setError('');
            if (invalidField === 'subject') setInvalidField(null);
          }}
          aria-invalid={subjectError ? true : undefined}
          aria-describedby={subjectError && error ? 'question-error' : undefined}
        />
      </div>
      <div className="field">
        <label htmlFor="question-body">Your question</label>
        <textarea
          id="question-body"
          rows={5}
          maxLength={BODY_MAX}
          value={body}
          onChange={e => {
            setBody(e.target.value);
            setSent('');
            setError('');
            if (invalidField === 'body') setInvalidField(null);
          }}
          aria-invalid={bodyError ? true : undefined}
          aria-describedby={bodyError && error ? 'question-body-hint question-error' : 'question-body-hint'}
        />
        <p className="hint" id="question-body-hint">Up to {BODY_MAX} characters. Your doctor reads it in their message inbox.</p>
      </div>
      {error && (
        <div id="question-error">
          <ErrorMessage error={error} />
        </div>
      )}
      {sent && <p className="alert alert-success" role="status"><span aria-hidden="true">✓ </span>{sent}</p>}
      <button type="submit" className="button button-primary" disabled={busy}>
        <Icon name="send" />{busy ? 'Sending…' : 'Send question'}
      </button>
    </form>
  );
}

// The Messages tab: ask a question (or email the bot address) and read replies.
export function PatientMessages() {
  const { api } = useAuth();
  const [messages, setMessages] = useState(null);
  const [error, setError] = useState(null);
  const [bot, setBot] = useState(null);

  const load = useCallback(async signal => {
    try {
      const data = await api('/api/messages', { signal });
      setMessages(data.messages);
      setError(null);
    } catch (failure) {
      if (failure?.name !== 'AbortError' && failure?.status !== 401) setError(failure);
    }
  }, [api]);

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    const timer = setInterval(() => load(controller.signal), REFRESH_MS);
    api('/api/bot/info', { signal: controller.signal }).then(setBot).catch(() => {});
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [api, load]);

  return (
    <section aria-labelledby="messages-heading">
      <div id="messages-heading"><ScreenHeading>Messages</ScreenHeading></div>
      <p>Ask your doctor a question about your exercises. Replies appear below.</p>
      {bot?.address && (
        <div className="alert alert-info">
          <p>
            <Icon name="mail" /> You can also email <strong>MotionTrack Care Bot</strong> (
            <a href={`mailto:${encodeURIComponent(bot.address)}`}>
              <strong className="break">{bot.address}</strong>
            </a>
            ) from <strong className="break">{bot.email}</strong>. Emails from other addresses are not delivered.
          </p>
          <CopyButton text={bot.address} label="Copy email" copiedLabel="Email copied" />
        </div>
      )}
      <AskForm onSent={() => load()} />
      <h3>Your questions</h3>
      {error && <ErrorMessage error={error} onRetry={() => load()} />}
      {!messages && !error && <Loading label="Loading your messages…" />}
      {messages?.length === 0 && <p className="empty">You have not sent any questions yet.</p>}
      {messages?.length > 0 && (
        <ul className="list message-list">
          {messages.map(message => (
            <li key={message.id} className="message">
              <div className="message-head">
                <strong className="message-subject">{message.subject}</strong>
                <span className="hint">Sent {formatDateTime(message.received_at)} · {sourceLabel(message.source)}</span>
              </div>
              <p className="message-body">{message.body}</p>
              {message.doctor_reply ? (
                <div className="message-reply">
                  <p className="eyebrow">Reply{message.replied_by_name ? ` from ${message.replied_by_name}` : ''} · {formatDateTime(message.replied_at)}</p>
                  <p className="message-body">{message.doctor_reply}</p>
                </div>
              ) : (
                <p className="idle-text"><Icon name="clock" />No reply yet</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

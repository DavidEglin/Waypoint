import { useState, type FormEvent } from 'react';
import { CONNECTION_ERROR_TEXT, type CanvasConnectionInfo, type ConnectionInfo, type ConnectionKind, type ConnectionsResponse, type Theme } from '@waypoint/shared';
import { api, errorMessage } from '../api';
import { useAuth } from '../auth';
import { Alert, Check } from '../components/Icons';
import { FormError, SecretField, TextField, formatDate, useToast } from '../components/ui';
import { useConnections } from '../useConnections';
import { ChangePasswordForm } from './ChangePassword';

const THEMES: { value: Theme; label: string }[] = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'Match device' },
];

function StatusLine({ info }: { info: ConnectionInfo }) {
  if (!info.connected) return <div className="status-line"><span className="chip">Not connected</span></div>;
  return (
    <div className="status-line">
      {info.status === 'ok' && <span className="chip chip-ok"><Check /> Connected</span>}
      {info.status === 'failed' && <span className="chip chip-bad"><Alert /> Problem</span>}
      {info.status === 'untested' && <span className="chip chip-warn">Saved, not tested</span>}
      {info.lastVerified && <span className="mono">Last verified {formatDate(info.lastVerified)}</span>}
      {info.status === 'failed' && info.lastError && <span role="alert" style={{ color: 'var(--danger)', fontSize: '0.9rem' }}>{CONNECTION_ERROR_TEXT[info.lastError]}</span>}
    </div>
  );
}

function ConnectionCard({
  kind, title, blurb, info, children, values, onSaved, canSave,
}: {
  kind: ConnectionKind;
  title: string;
  blurb: string;
  info: ConnectionInfo;
  children: React.ReactNode;
  values: unknown;
  canSave: boolean;
  onSaved(next: Partial<ConnectionsResponse>): void;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState<null | 'save' | 'test' | 'disconnect'>(null);
  const [error, setError] = useState<string | null>(null);

  const apply = (next: ConnectionInfo | CanvasConnectionInfo) => onSaved({ [kind]: next } as Partial<ConnectionsResponse>);

  async function test(): Promise<ConnectionInfo> {
    const result = await api<ConnectionInfo>('POST', `/api/connections/${kind}/test`);
    apply(result);
    return result;
  }

  async function saveAndTest(e: FormEvent) {
    e.preventDefault();
    setBusy('save');
    setError(null);
    try {
      apply(await api<ConnectionInfo>('PUT', `/api/connections/${kind}`, values));
      const result = await test();
      toast(result.status === 'ok' ? `${title} connected` : `${title} saved, but the test failed`);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function retest() {
    setBusy('test');
    setError(null);
    try {
      const result = await test();
      toast(result.status === 'ok' ? `${title} is working` : 'The test failed');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function disconnect() {
    setBusy('disconnect');
    setError(null);
    try {
      await api('DELETE', `/api/connections/${kind}`);
      const cleared: ConnectionInfo = { connected: false, status: 'untested', lastVerified: null, lastError: null };
      apply(kind === 'canvas' ? { ...cleared, baseUrl: null } : cleared);
      toast(`${title} disconnected`);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="card" aria-labelledby={`${kind}-title`}>
      <div className="card-head">
        <div>
          <h2 id={`${kind}-title`}>{title}</h2>
          <p className="card-sub">{blurb}</p>
        </div>
      </div>
      <StatusLine info={info} />
      <form onSubmit={saveAndTest}>
        {children}
        <FormError message={error} />
        <div className="btn-row">
          <button className="btn btn-primary" disabled={busy !== null || !canSave}>{busy === 'save' ? 'Saving…' : info.connected ? 'Replace and test' : 'Save and test'}</button>
          {info.connected && (
            <>
              <button type="button" className="btn" disabled={busy !== null} onClick={() => void retest()}>{busy === 'test' ? 'Testing…' : 'Test connection'}</button>
              <button type="button" className="btn btn-danger" disabled={busy !== null} onClick={() => void disconnect()}>Disconnect</button>
            </>
          )}
        </div>
      </form>
    </section>
  );
}

export function Settings() {
  const { user, setTheme } = useAuth();
  const toast = useToast();
  const { data, error, setData } = useConnections();
  const [themeError, setThemeError] = useState<string | null>(null);

  const [canvasUrl, setCanvasUrl] = useState('');
  const [canvasToken, setCanvasToken] = useState('');
  const [claudeKey, setClaudeKey] = useState('');

  const merge = (next: Partial<ConnectionsResponse>) => setData((d) => (d ? { ...d, ...next } : d));

  async function pickTheme(theme: Theme) {
    setThemeError(null);
    try {
      await setTheme(theme);
    } catch (e) {
      setThemeError(`Applied here, but could not be saved to your account: ${errorMessage(e)}`);
    }
  }

  return (
    <div className="page page-narrow">
      <div className="page-head">
        <p className="kicker">Configuration</p>
        <h1>Settings</h1>
      </div>

      <div className="stack">
        <section className="card" aria-labelledby="appearance-title">
          <div className="card-head"><h2 id="appearance-title">Appearance</h2></div>
          <fieldset className="choice-set">
            <legend className="sr-only">Colour theme</legend>
            <div className="choices">
              {THEMES.map((t) => (
                <label key={t.value} className="choice">
                  <input type="radio" name="theme" value={t.value} checked={user?.theme === t.value} onChange={() => void pickTheme(t.value)} />
                  <span>{t.label}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <FormError message={themeError} />
        </section>

        {error && <p className="callout callout-error" role="alert"><Alert /> <span>{error}</span></p>}

        {data && (
          <>
            <ConnectionCard
              kind="canvas" title="Canvas" info={data.canvas} onSaved={merge}
              blurb="Your school's Canvas address and a personal access token, so Waypoint can read your courses."
              values={{ baseUrl: canvasUrl, token: canvasToken }} canSave={!!canvasUrl.trim() && !!canvasToken.trim()}
            >
              <TextField label="Canvas address" value={canvasUrl} onChange={(e) => setCanvasUrl(e.target.value)} placeholder={data.canvas.baseUrl ?? 'canvas.yourschool.edu'} inputMode="url" autoCapitalize="off" autoComplete="off" hint={data.canvas.baseUrl ? `Currently ${data.canvas.baseUrl}` : 'Just the website name.'} />
              <SecretField label="Access token" value={canvasToken} onChange={(e) => setCanvasToken(e.target.value)} autoComplete="off" placeholder={data.canvas.connected ? 'Saved. Enter a new one to replace it.' : ''} hint="In Canvas: Account, then Settings, then Approved Integrations, then New Access Token. It is stored encrypted and never shown again." />
            </ConnectionCard>

            <ConnectionCard
              kind="claude" title="Claude API key" info={data.claude} onSaved={merge}
              blurb="Waypoint uses your own key to read notifications. Nothing is shared with anyone else."
              values={{ apiKey: claudeKey }} canSave={!!claudeKey.trim()}
            >
              <SecretField label="API key" value={claudeKey} onChange={(e) => setClaudeKey(e.target.value)} autoComplete="off" placeholder={data.claude.connected ? 'Saved. Enter a new one to replace it.' : 'sk-ant-…'} hint="Stored encrypted and never shown again." />
            </ConnectionCard>
          </>
        )}

        <section className="card" aria-labelledby="account-title">
          <div className="card-head">
            <div>
              <h2 id="account-title">Account</h2>
              <p className="card-sub">Signed in as <strong>{user?.username}</strong>. Changing your password signs out your other devices.</p>
            </div>
          </div>
          <ChangePasswordForm onDone={() => toast('Other devices have been signed out')} />
        </section>
      </div>
    </div>
  );
}

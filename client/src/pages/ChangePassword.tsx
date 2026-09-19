import { MIN_PASSWORD_LENGTH } from '@waypoint/shared';
import { useState, type FormEvent } from 'react';
import { api, errorMessage } from '../api';
import { useAuth } from '../auth';
import { BrandMark, Info } from '../components/Icons';
import { FormError, SecretField, useToast } from '../components/ui';

/** Shown full-screen when a temporary password must be replaced, and reused inside Settings. */
export function ChangePasswordForm({ forced, onDone }: { forced?: boolean; onDone?: () => void }) {
  const { refresh } = useAuth();
  const toast = useToast();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const tooShort = next.length > 0 && next.length < MIN_PASSWORD_LENGTH;
  const mismatch = again.length > 0 && again !== next;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (next.length < MIN_PASSWORD_LENGTH) return setError(`Use at least ${MIN_PASSWORD_LENGTH} characters.`);
    if (next !== again) return setError('The two new passwords do not match.');
    setBusy(true);
    try {
      await api('POST', '/api/me/password', { currentPassword: current, newPassword: next });
      toast('Password changed');
      setCurrent(''); setNext(''); setAgain('');
      await refresh();
      onDone?.();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <SecretField label={forced ? 'Temporary password' : 'Current password'} value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" required />
      <SecretField label="New password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" hint={`At least ${MIN_PASSWORD_LENGTH} characters. A few random words works well.`} required aria-invalid={tooShort} />
      <SecretField label="New password again" value={again} onChange={(e) => setAgain(e.target.value)} autoComplete="new-password" required aria-invalid={mismatch} />
      <FormError message={error} />
      <button className="btn btn-primary" disabled={busy || !current || !next || !again}>{busy ? 'Saving…' : 'Change password'}</button>
    </form>
  );
}

export function ChangePassword({ forced }: { forced: boolean }) {
  const { signOut } = useAuth();
  return (
    <div className="center-screen">
      <div className="card center-card">
        <div className="brand"><BrandMark /> Waypoint</div>
        <h1>Choose a new password</h1>
        {forced && (
          <p className="callout" style={{ margin: '12px 0 18px' }}>
            <Info /> <span>You signed in with a temporary password. Pick your own before continuing.</span>
          </p>
        )}
        <ChangePasswordForm forced={forced} />
        <button className="btn btn-quiet" style={{ width: '100%', marginTop: 10 }} onClick={() => void signOut()}>Sign out</button>
      </div>
    </div>
  );
}

import { useState, type FormEvent } from 'react';
import { errorMessage } from '../api';
import { useAuth } from '../auth';
import { BrandMark } from '../components/Icons';
import { FormError, SecretField, TextField } from '../components/ui';

export function SignIn() {
  const { signIn } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await signIn({ username, password });
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <div className="center-screen">
      <form className="card center-card" onSubmit={submit}>
        <div className="brand"><BrandMark /> Waypoint</div>
        <h1>Sign in</h1>
        <p className="lede">Your study folders, in one place.</p>
        <TextField label="Username" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoCapitalize="off" autoFocus required />
        <SecretField label="Password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
        <FormError message={error} />
        <button className="btn btn-primary" disabled={busy || !username || !password}>{busy ? 'Signing in…' : 'Sign in'}</button>
        <p className="hint" style={{ marginTop: 14 }}>Accounts are created by an administrator.</p>
      </form>
    </div>
  );
}

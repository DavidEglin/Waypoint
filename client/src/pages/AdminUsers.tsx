import { MIN_PASSWORD_LENGTH, type AdminUser } from '@waypoint/shared';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, errorMessage } from '../api';
import { useAuth } from '../auth';
import { Plus } from '../components/Icons';
import { FormError, Modal, SecretField, TextField, formatDate, useToast } from '../components/ui';

const ALPHABET = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** 16 characters from an alphabet without look-alikes (no 0/O, 1/l/I). */
function generatePassword(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('');
}

type Dialog =
  | { kind: 'add' }
  | { kind: 'reset'; user: AdminUser }
  | { kind: 'delete'; user: AdminUser }
  | { kind: 'shown'; title: string; username: string; password: string };

function AddUserDialog({ onClose, onCreated }: { onClose(): void; onCreated(u: AdminUser, password: string): void }) {
  const [username, setUsername] = useState('');
  const [role, setRole] = useState<'user' | 'admin'>('user');
  const [password, setPassword] = useState(generatePassword);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const created = await api<AdminUser>('POST', '/api/admin/users', { username, role, temporaryPassword: password });
      onCreated(created, password);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <Modal title="Add a user" onClose={onClose}>
      <form onSubmit={submit}>
        <TextField label="Username" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="off" autoCapitalize="off" hint="Letters, numbers, dots, dashes and underscores." required autoFocus />
        <div className="field">
          <label htmlFor="new-role">Role</label>
          <select id="new-role" className="input" value={role} onChange={(e) => setRole(e.target.value as 'user' | 'admin')}>
            <option value="user">Student</option>
            <option value="admin">Admin</option>
          </select>
        </div>
        <SecretField label="Temporary password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="off" hint={`They must change it at first sign-in. At least ${MIN_PASSWORD_LENGTH} characters.`} required />
        <FormError message={error} />
        <div className="btn-row">
          <button type="button" className="btn btn-quiet" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={busy || !username}>{busy ? 'Adding…' : 'Add user'}</button>
        </div>
      </form>
    </Modal>
  );
}

function ResetDialog({ user, onClose, onDone }: { user: AdminUser; onClose(): void; onDone(password: string): void }) {
  const [password, setPassword] = useState(generatePassword);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('POST', `/api/admin/users/${user.id}/reset-password`, { temporaryPassword: password });
      onDone(password);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <Modal title={`Reset password for ${user.username}`} onClose={onClose}>
      <form onSubmit={submit}>
        <p className="card-sub" style={{ marginBottom: 14 }}>They will be signed out everywhere and must choose a new password next time.</p>
        <SecretField label="Temporary password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="off" required />
        <FormError message={error} />
        <div className="btn-row">
          <button type="button" className="btn btn-quiet" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={busy}>{busy ? 'Resetting…' : 'Reset password'}</button>
        </div>
      </form>
    </Modal>
  );
}

function DeleteDialog({ user, onClose, onDone }: { user: AdminUser; onClose(): void; onDone(): void }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      await api('DELETE', `/api/admin/users/${user.id}`);
      onDone();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <Modal title={`Delete ${user.username}?`} onClose={onClose}>
      <p style={{ marginBottom: 14 }}>This permanently removes the account and everything saved under it, including their connections. It cannot be undone.</p>
      <FormError message={error} />
      <div className="btn-row">
        <button type="button" className="btn btn-quiet" onClick={onClose}>Cancel</button>
        <button className="btn btn-danger" disabled={busy} onClick={() => void confirm()}>{busy ? 'Deleting…' : 'Delete user'}</button>
      </div>
    </Modal>
  );
}

function ShownDialog({ title, username, password, onClose }: { title: string; username: string; password: string; onClose(): void }) {
  const toast = useToast();
  async function copy() {
    try {
      await navigator.clipboard.writeText(password);
      toast('Copied');
    } catch {
      toast('Could not copy. Select the password and copy it by hand.');
    }
  }
  return (
    <Modal title={title} onClose={onClose}>
      <p style={{ marginBottom: 12 }}>Give <strong>{username}</strong> this temporary password. It is shown only now.</p>
      <p className="secret">{password}</p>
      <div className="btn-row" style={{ marginTop: 14 }}>
        <button className="btn" onClick={() => void copy()}>Copy</button>
        <button className="btn btn-primary" onClick={onClose}>Done</button>
      </div>
    </Modal>
  );
}

export function AdminUsers() {
  const { user: me } = useAuth();
  const toast = useToast();
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);

  const load = useCallback(async () => {
    try {
      setUsers(await api<AdminUser[]>('GET', '/api/admin/users'));
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function toggle(u: AdminUser) {
    try {
      await api('PATCH', `/api/admin/users/${u.id}`, { active: !u.active });
      toast(u.active ? `${u.username} disabled` : `${u.username} enabled`);
      await load();
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  const close = () => setDialog(null);

  return (
    <div className="page">
      <div className="page-head">
        <p className="kicker">Admin</p>
        <h1>Users</h1>
        <p>Create accounts and manage who can sign in. There is no self sign-up.</p>
      </div>

      <section className="card" aria-labelledby="users-title">
        <div className="card-head">
          <h2 id="users-title">Accounts</h2>
          <button className="btn btn-primary" onClick={() => setDialog({ kind: 'add' })}><Plus /> Add user</button>
        </div>
        <FormError message={error} />
        {!users ? <p className="mono" role="status">Loading…</p> : (
          <ul className="users">
            {users.map((u) => (
              <li key={u.id} className="user-row">
                <div>
                  <div className="user-name">{u.username}{u.id === me?.id && <span className="mono"> (you)</span>}</div>
                  <div className="user-meta">
                    <span className="chip">{u.role === 'admin' ? 'Admin' : 'Student'}</span>
                    <span className={`chip ${u.active ? 'chip-ok' : 'chip-bad'}`}>{u.active ? 'Active' : 'Disabled'}</span>
                    {u.mustChangePassword && <span className="chip chip-warn">Temporary password</span>}
                  </div>
                </div>
                <div className="mono">Last sign-in: {formatDate(u.lastSignIn)}</div>
                <div className="user-actions">
                  <button className="btn" onClick={() => setDialog({ kind: 'reset', user: u })} aria-label={`Reset password for ${u.username}`}>Reset password</button>
                  {u.id !== me?.id && (
                    <>
                      <button className="btn" onClick={() => void toggle(u)} aria-label={`${u.active ? 'Disable' : 'Enable'} ${u.username}`}>{u.active ? 'Disable' : 'Enable'}</button>
                      <button className="btn btn-danger" onClick={() => setDialog({ kind: 'delete', user: u })} aria-label={`Delete ${u.username}`}>Delete</button>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {dialog?.kind === 'add' && (
        <AddUserDialog onClose={close} onCreated={(u, password) => { setDialog({ kind: 'shown', title: 'User added', username: u.username, password }); void load(); }} />
      )}
      {dialog?.kind === 'reset' && (
        <ResetDialog user={dialog.user} onClose={close} onDone={(password) => { setDialog({ kind: 'shown', title: 'Password reset', username: dialog.user.username, password }); void load(); }} />
      )}
      {dialog?.kind === 'delete' && (
        <DeleteDialog user={dialog.user} onClose={close} onDone={() => { toast(`${dialog.user.username} deleted`); close(); void load(); }} />
      )}
      {dialog?.kind === 'shown' && <ShownDialog title={dialog.title} username={dialog.username} password={dialog.password} onClose={close} />}
    </div>
  );
}

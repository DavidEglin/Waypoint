import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { READ_ERROR_TEXT, type AssessmentDetail, type ReadErrorCode } from '@waypoint/shared';
import { ApiFailure, api, errorMessage } from '../api';
import { Alert, Download, Info } from '../components/Icons';
import { FormError, Modal, formatDate, useToast } from '../components/ui';
import { countdown, formatBytes, formatDue } from '../format';

/** Failures the student can fix in Settings rather than by trying a different file. */
const SETTINGS_CODES: ReadErrorCode[] = ['bad_credentials', 'no_claude_key', 'no_canvas', 'rate_limited'];

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="confirm-field">
      <span className="cf-label">{label}</span>
      <div className="cf-value">{children}</div>
    </div>
  );
}
const Missing = () => <span className="not-found">Not found in the notification</span>;

function Reading({ a }: { a: AssessmentDetail }) {
  return (
    <section className="card reading" aria-live="polite">
      <div className="reading-dots" aria-hidden="true"><span /><span /><span /></div>
      <h2>Reading your notification…</h2>
      <p className="card-sub">
        {a.source === 'canvas' ? 'Pulling the assignment, rubric and any linked files from Canvas.' : a.source === 'photo' ? 'Reading the text from your photo.' : 'Reading your document.'}{' '}
        This usually takes under a minute.
      </p>
    </section>
  );
}

function Failed({ a, onRetry, onDelete, busy, error }: { a: AssessmentDetail; onRetry(): void; onDelete(): void; busy: boolean; error: string | null }) {
  const code = a.errorCode ?? 'internal';
  return (
    <section className="card" aria-labelledby="failed-title">
      <h2 id="failed-title">Waypoint could not read this one</h2>
      <p className="callout callout-error" role="alert" style={{ margin: '14px 0' }}>
        <Alert /> <span>{READ_ERROR_TEXT[code]}</span>
      </p>
      <FormError message={error} />
      <div className="btn-row">
        <button className="btn btn-primary" onClick={onRetry} disabled={busy}>Try again</button>
        {SETTINGS_CODES.includes(code) && <Link className="btn" to="/settings">Open Settings</Link>}
        {a.source !== 'canvas' && <Link className="btn" to="/add">Upload a different file</Link>}
        <button className="btn btn-danger" onClick={onDelete} disabled={busy}>Delete</button>
      </div>
    </section>
  );
}

function Review({ a }: { a: AssessmentDetail }) {
  const method = a.readMethod === 'canvas' ? 'Read from Canvas' : a.readMethod === 'vision' ? 'Read from an image by Claude' : 'Read from the document text';
  const keywords = a.topics.filter((t) => t.kind === 'keyword');
  const skills = a.topics.filter((t) => t.kind === 'skill');
  return (
    <section className="card confirm-card" aria-labelledby="review-title">
      <p className="kicker">Step 2 of 3</p>
      <h2 id="review-title" className="review-title">Here is what Waypoint found</h2>
      <p className="card-sub">Check it against your notification. Nothing is searched until you have confirmed it.</p>

      <div className="source-line">
        <span className="mono">{method}{a.sourceFile?.name ? ` · ${a.sourceFile.name} (${formatBytes(a.sourceFile.size)})` : ''}</span>
        {a.sourceFile && (
          <a className="btn btn-quiet" href={`/api/assessments/${a.id}/source`} download><Download /> Download original</a>
        )}
      </div>

      <Field label="Assessment">{a.title}</Field>
      <Field label="Course">{a.courseName ?? <Missing />}</Field>
      {a.parts.length === 0 ? (
        <Field label="Due"><Missing /></Field>
      ) : (
        a.parts.map((p, i) => (
          <Field key={i} label={a.parts.length > 1 ? `${p.label} due` : 'Due'}>
            {p.dueAt ? <><strong>{formatDue(p.dueAt, p.dueHasTime)}</strong> <span className="mono">· {countdown(p.dueAt)}</span></> : <Missing />}
            {p.dueText && <div className="cf-note">“{p.dueText}”</div>}
            {p.description && <div className="cf-note">{p.description}</div>}
          </Field>
        ))
      )}
      <Field label="Weighting">{a.weightingText ?? <Missing />}</Field>
      <Field label="AI use">
        {a.aiUse ? <div className="notice-box"><Info /> <span>{a.aiUse}</span></div> : <Missing />}
      </Field>
      {a.needsOwnFocus && <Field label="Your own angle"><span>{a.focusPrompt ?? 'You choose your own focus for this task.'}</span> <span className="cf-note">You will be asked to pick one before Waypoint searches.</span></Field>}
      <Field label="Topics found">
        {a.topics.length === 0 ? <Missing /> : (
          <>
            <div className="chips">{keywords.map((t) => <span key={t.text} className="chip chip-topic">{t.text}</span>)}</div>
            {skills.length > 0 && (
              <>
                <div className="cf-note">Skills you are marked on (these need a different kind of matching):</div>
                <div className="chips">{skills.map((t) => <span key={t.text} className="chip chip-skill">{t.text}</span>)}</div>
              </>
            )}
          </>
        )}
      </Field>

      <p className="callout" style={{ marginTop: 18 }}>
        <Info /> <span>Correcting anything that is wrong, and confirming, comes next. Then Waypoint searches your course for what matches.</span>
      </p>
    </section>
  );
}

export function AssessmentPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const [a, setA] = useState<AssessmentDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const load = useCallback(async () => {
    try {
      setA(await api<AssessmentDetail>('GET', `/api/assessments/${id}`));
    } catch (e) {
      if (e instanceof ApiFailure && e.status === 404) setNotFound(true);
      else setError(errorMessage(e));
    }
  }, [id]);
  useEffect(() => { void load(); }, [load]);

  const reading = a?.status === 'reading';
  useEffect(() => {
    if (!reading) return;
    const t = setInterval(() => void load(), 2000);
    return () => clearInterval(t);
  }, [reading, load]);

  async function retry() {
    setBusy(true);
    setError(null);
    try {
      setA(await api<AssessmentDetail>('POST', `/api/assessments/${id}/retry`));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      await api('DELETE', `/api/assessments/${id}`);
      toast('Assessment deleted');
      navigate('/');
    } catch (e) {
      setError(errorMessage(e));
      setConfirmDelete(false);
      setBusy(false);
    }
  }

  if (notFound) {
    return (
      <div className="page page-narrow">
        <section className="card empty"><h2>That assessment is not here</h2><p>It may have been deleted.</p><Link className="btn btn-primary" to="/">Back to assessments</Link></section>
      </div>
    );
  }

  return (
    <div className="page page-narrow">
      <p className="crumbs"><Link to="/">Assessments</Link> <span aria-hidden="true">/</span> <span>{a?.title ?? '…'}</span></p>
      {a && (
        <div className="page-head">
          {a.courseName && <p className="kicker">{a.courseName}</p>}
          <h1>{a.title}</h1>
          <p className="mono">Added {formatDate(a.createdAt)}</p>
        </div>
      )}
      <div className="stack">
        {!a && !error && <p className="mono" role="status">Loading…</p>}
        {!a && <FormError message={error} />}
        {a?.status === 'reading' && <Reading a={a} />}
        {a?.status === 'failed' && <Failed a={a} onRetry={() => void retry()} onDelete={() => setConfirmDelete(true)} busy={busy} error={error} />}
        {a && a.status !== 'reading' && a.status !== 'failed' && <Review a={a} />}
        {a && a.status !== 'failed' && (
          <div><button className="btn btn-quiet btn-danger-quiet" onClick={() => setConfirmDelete(true)}>Delete this assessment</button></div>
        )}
      </div>

      {confirmDelete && (
        <Modal title="Delete this assessment?" onClose={() => setConfirmDelete(false)}>
          <p style={{ marginBottom: 14 }}>This removes it and the file you uploaded. It cannot be undone.</p>
          <div className="btn-row">
            <button className="btn btn-quiet" onClick={() => setConfirmDelete(false)}>Cancel</button>
            <button className="btn btn-danger" disabled={busy} onClick={() => void remove()}>{busy ? 'Deleting…' : 'Delete'}</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

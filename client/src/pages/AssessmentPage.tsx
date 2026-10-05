import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { READ_ERROR_TEXT, type AssessmentDetail, type ConfirmAssessmentRequest, type ReadErrorCode } from '@waypoint/shared';
import { ApiFailure, api, errorMessage } from '../api';
import { Alert, Download, Info, Plus, X } from '../components/Icons';
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

function Searching({ a }: { a: AssessmentDetail }) {
  return (
    <section className="card reading" aria-live="polite">
      <div className="reading-dots" aria-hidden="true"><span /><span /><span /></div>
      <h2>Searching your course…</h2>
      <p className="card-sub">Looking through pages and files for what matches {a.title}. This can take a little while for a large course.</p>
    </section>
  );
}

function Failed({ a, onRetry, onDelete, busy, error }: { a: AssessmentDetail; onRetry(): void; onDelete(): void; busy: boolean; error: string | null }) {
  const code = a.errorCode ?? 'internal';
  // read_method is only ever set once the original read succeeded, so its presence means this failure
  // happened later, while searching the course - not while reading the notification itself.
  const searchStage = a.readMethod !== null;
  return (
    <section className="card" aria-labelledby="failed-title">
      <h2 id="failed-title">{searchStage ? 'Waypoint could not search your course' : 'Waypoint could not read this one'}</h2>
      <p className="callout callout-error" role="alert" style={{ margin: '14px 0' }}>
        <Alert /> <span>{READ_ERROR_TEXT[code]}</span>
      </p>
      <FormError message={error} />
      <div className="btn-row">
        <button className="btn btn-primary" onClick={onRetry} disabled={busy}>Try again</button>
        {SETTINGS_CODES.includes(code) && <Link className="btn" to="/settings">Open Settings</Link>}
        {!searchStage && a.source !== 'canvas' && <Link className="btn" to="/add">Upload a different file</Link>}
        <button className="btn btn-danger" onClick={onDelete} disabled={busy}>Delete</button>
      </div>
    </section>
  );
}

function sourceLine(a: AssessmentDetail) {
  const method = a.readMethod === 'canvas' ? 'Read from Canvas' : a.readMethod === 'vision' ? 'Read from an image by Claude' : 'Read from the document text';
  return (
    <div className="source-line">
      <span className="mono">{method}{a.sourceFile?.name ? ` · ${a.sourceFile.name} (${formatBytes(a.sourceFile.size)})` : ''}</span>
      {a.sourceFile && <a className="btn btn-quiet" href={`/api/assessments/${a.id}/source`} download><Download /> Download original</a>}
    </div>
  );
}

/** Read-only, once confirmed: nothing to correct any more. */
function Confirmed({ a }: { a: AssessmentDetail }) {
  const keywords = a.topics.filter((t) => t.kind === 'keyword');
  const skills = a.topics.filter((t) => t.kind === 'skill');
  return (
    <section className="card confirm-card" aria-labelledby="review-title">
      <p className="kicker">Confirmed</p>
      <h2 id="review-title" className="review-title">{a.title}</h2>
      {sourceLine(a)}

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
      {a.needsOwnFocus && (
        <Field label="Your own angle">
          <span>{a.chosenFocus ?? a.focusPrompt ?? 'You choose your own focus for this task.'}</span>
        </Field>
      )}
      <Field label="Topics">
        {a.topics.length === 0 ? <Missing /> : (
          <>
            <div className="chips">{keywords.map((t) => <span key={t.text} className="chip chip-topic">{t.text}</span>)}</div>
            {skills.length > 0 && <div className="chips">{skills.map((t) => <span key={t.text} className="chip chip-skill">{t.text}</span>)}</div>}
          </>
        )}
      </Field>

      <p className="callout" style={{ marginTop: 18 }}>
        <Info /> <span>Confirmed. Waiting to search your course.</span>
      </p>
    </section>
  );
}

/** Minimal results view (M4): what was found, grouped loosely by module. The full study folder (grouped by topic, original notification always included) is a later build. */
function Folder({ a }: { a: AssessmentDetail }) {
  return (
    <section className="card confirm-card" aria-labelledby="review-title">
      <p className="kicker">Ready</p>
      <h2 id="review-title" className="review-title">{a.title}</h2>
      {sourceLine(a)}

      <Field label="Course">{a.courseName ?? <Missing />}</Field>
      {a.parts.map((p, i) => (
        <Field key={i} label={a.parts.length > 1 ? `${p.label} due` : 'Due'}>
          {p.dueAt ? <><strong>{formatDue(p.dueAt, p.dueHasTime)}</strong> <span className="mono">· {countdown(p.dueAt)}</span></> : <Missing />}
        </Field>
      ))}

      <p className="callout" style={{ margin: '18px 0' }}>
        <Info />
        <span>
          {a.folderItems.length === 0
            ? 'Waypoint searched your course but found nothing matching these topics.'
            : `Found ${a.folderItems.length} match${a.folderItems.length === 1 ? '' : 'es'} in your course.`}{' '}
          This is an early, minimal view - the real study folder (grouped by topic, with your original notification alongside) is not built yet.
        </span>
      </p>

      {a.folderItems.length > 0 && (
        <ul className="found-list">
          {a.folderItems.map((f, i) => (
            <li key={i}>
              <div style={{ minWidth: 0 }}>
                {f.moduleName && <p className="kicker">{f.moduleName}</p>}
                <p className="found-name">{f.title}</p>
                {f.snippet && <p className="cf-note">{f.snippet}</p>}
                <div className="chips" style={{ marginTop: 6 }}>{f.matchedTerms.map((t) => <span key={t} className="chip chip-topic">{t}</span>)}</div>
              </div>
              {f.htmlUrl && <a className="btn btn-quiet" href={f.htmlUrl} target="_blank" rel="noreferrer">Open in Canvas</a>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

interface DraftPart { label: string; description: string; dueDate: string; dueTime: string; dueText: string }
interface DraftTopic { text: string; kind: 'keyword' | 'skill' }
interface Draft {
  title: string; courseLabel: string; weightingText: string; weightingPercent: string; aiUse: string;
  needsOwnFocus: boolean; focusPrompt: string; chosenFocus: string; parts: DraftPart[]; topics: DraftTopic[];
}

const pad = (n: number) => String(n).padStart(2, '0');
/** The input[type=date]/[type=time] values for an ISO instant, in the browser's own time zone - the same zone formatDue() already displays in. */
const toLocalDate = (iso: string) => { const d = new Date(iso); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const toLocalTime = (iso: string) => { const d = new Date(iso); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };

function draftFromDetail(a: AssessmentDetail): Draft {
  return {
    title: a.title,
    courseLabel: a.courseName ?? '',
    weightingText: a.weightingText ?? '',
    weightingPercent: a.weightingPercent !== null ? String(a.weightingPercent) : '',
    aiUse: a.aiUse ?? '',
    needsOwnFocus: a.needsOwnFocus,
    focusPrompt: a.focusPrompt ?? '',
    chosenFocus: a.chosenFocus ?? '',
    parts: a.parts.map((p) => ({
      label: p.label,
      description: p.description ?? '',
      dueDate: p.dueAt ? toLocalDate(p.dueAt) : '',
      dueTime: p.dueAt && p.dueHasTime ? toLocalTime(p.dueAt) : '',
      dueText: p.dueText ?? '',
    })),
    topics: a.topics.map((t) => ({ text: t.text, kind: t.kind })),
  };
}

function draftToPayload(d: Draft): ConfirmAssessmentRequest {
  return {
    title: d.title.trim(),
    courseLabel: d.courseLabel.trim() || null,
    weightingText: d.weightingText.trim() || null,
    weightingPercent: d.weightingPercent.trim() === '' ? null : Number(d.weightingPercent),
    aiUse: d.aiUse.trim() || null,
    needsOwnFocus: d.needsOwnFocus,
    focusPrompt: d.needsOwnFocus ? d.focusPrompt.trim() || null : null,
    chosenFocus: d.chosenFocus.trim() || null,
    parts: d.parts
      .filter((p) => p.label.trim() || p.dueDate || p.dueText.trim() || p.description.trim())
      .map((p) => ({
        label: p.label.trim() || 'Due',
        description: p.description.trim() || null,
        dueAt: p.dueDate ? new Date(`${p.dueDate}T${p.dueTime || '23:59'}`).toISOString() : null,
        dueHasTime: p.dueDate !== '' && p.dueTime !== '',
        dueText: p.dueText.trim() || null,
      })),
    topics: d.topics.filter((t) => t.text.trim()).map((t) => ({ text: t.text.trim(), kind: t.kind })),
  };
}

/** Editable: correct what Waypoint found, then confirm. The only screen where an assessment's fields can be changed. */
function ConfirmForm({ a, onConfirmed }: { a: AssessmentDetail; onConfirmed(updated: AssessmentDetail): void }) {
  const [d, setD] = useState<Draft>(() => draftFromDetail(a));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const updatePart = (i: number, patch: Partial<DraftPart>) =>
    setD((prev) => ({ ...prev, parts: prev.parts.map((p, idx) => (idx === i ? { ...p, ...patch } : p)) }));
  const addPart = () =>
    setD((prev) => ({ ...prev, parts: [...prev.parts, { label: prev.parts.length ? `Part ${prev.parts.length + 1}` : 'Due', description: '', dueDate: '', dueTime: '', dueText: '' }] }));
  const removePart = (i: number) => setD((prev) => ({ ...prev, parts: prev.parts.filter((_, idx) => idx !== i) }));

  const updateTopic = (i: number, patch: Partial<DraftTopic>) =>
    setD((prev) => ({ ...prev, topics: prev.topics.map((t, idx) => (idx === i ? { ...t, ...patch } : t)) }));
  const addTopic = () => setD((prev) => ({ ...prev, topics: [...prev.topics, { text: '', kind: 'keyword' }] }));
  const removeTopic = (i: number) => setD((prev) => ({ ...prev, topics: prev.topics.filter((_, idx) => idx !== i) }));

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      onConfirmed(await api<AssessmentDetail>('POST', `/api/assessments/${a.id}/confirm`, draftToPayload(d)));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card confirm-card" aria-labelledby="review-title">
      <p className="kicker">Step 2 of 3</p>
      <h2 id="review-title" className="review-title">Here is what Waypoint found</h2>
      <p className="card-sub">Correct anything that is wrong, then confirm. Nothing is searched until you do.</p>
      {sourceLine(a)}

      <div className="field">
        <label htmlFor="c-title">Assessment</label>
        <input id="c-title" className="input" value={d.title} maxLength={200} onChange={(e) => setD({ ...d, title: e.target.value })} />
      </div>
      <div className="field">
        <label htmlFor="c-course">Course</label>
        <input id="c-course" className="input" value={d.courseLabel} maxLength={200} onChange={(e) => setD({ ...d, courseLabel: e.target.value })} />
      </div>

      <label className="legend">Due dates</label>
      {d.parts.map((p, i) => (
        <div className="part-edit" key={i}>
          <div className="part-edit-head">
            <input className="input" value={p.label} maxLength={80} placeholder="Part label" aria-label={`Part ${i + 1} label`} onChange={(e) => updatePart(i, { label: e.target.value })} />
            <button type="button" className="btn btn-icon" aria-label={`Remove ${p.label || 'this part'}`} onClick={() => removePart(i)}><X /></button>
          </div>
          <div className="inline-fields">
            <div className="field">
              <label htmlFor={`due-date-${i}`}>Due date</label>
              <input id={`due-date-${i}`} className="input" type="date" value={p.dueDate} onChange={(e) => updatePart(i, { dueDate: e.target.value, dueTime: e.target.value ? p.dueTime : '' })} />
            </div>
            <div className="field">
              <label htmlFor={`due-time-${i}`}>Due time</label>
              <input id={`due-time-${i}`} className="input" type="time" value={p.dueTime} disabled={!p.dueDate} onChange={(e) => updatePart(i, { dueTime: e.target.value })} />
            </div>
          </div>
          <div className="field">
            <label htmlFor={`due-text-${i}`}>As worded in the notification</label>
            <input id={`due-text-${i}`} className="input" value={p.dueText} maxLength={200} placeholder="e.g. Wed 23 Sep, in class" onChange={(e) => updatePart(i, { dueText: e.target.value })} />
          </div>
        </div>
      ))}
      <div className="btn-row" style={{ marginBottom: 14 }}>
        <button type="button" className="btn btn-quiet" onClick={addPart}><Plus /> Add a due date</button>
      </div>

      <div className="field">
        <label htmlFor="c-weight-text">Weighting</label>
        <input id="c-weight-text" className="input" value={d.weightingText} maxLength={200} placeholder="e.g. 30% of course grade" onChange={(e) => setD({ ...d, weightingText: e.target.value })} />
      </div>
      <div className="field">
        <label htmlFor="c-weight-pct">Weighting (%)</label>
        <input id="c-weight-pct" className="input" type="number" min={0} max={100} value={d.weightingPercent} onChange={(e) => setD({ ...d, weightingPercent: e.target.value })} />
      </div>
      <div className="field">
        <label htmlFor="c-ai">AI use</label>
        <textarea id="c-ai" className="input" rows={3} value={d.aiUse} maxLength={1000} onChange={(e) => setD({ ...d, aiUse: e.target.value })} />
      </div>

      <div className="field">
        <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input type="checkbox" checked={d.needsOwnFocus} onChange={(e) => setD({ ...d, needsOwnFocus: e.target.checked })} />
          I need to choose my own focus for this task
        </label>
        {d.needsOwnFocus && (
          <>
            <input className="input" style={{ marginTop: 8 }} value={d.focusPrompt} maxLength={400} placeholder="What you're asked to choose (e.g. coffee or chocolate)" onChange={(e) => setD({ ...d, focusPrompt: e.target.value })} />
            <input className="input" style={{ marginTop: 8 }} value={d.chosenFocus} maxLength={200} placeholder="What you've chosen (optional for now)" onChange={(e) => setD({ ...d, chosenFocus: e.target.value })} />
          </>
        )}
      </div>

      <div className="field">
        <label>Topics found</label>
        {d.topics.map((t, i) => (
          <div className="topic-edit-row" key={i}>
            <input className="input" value={t.text} maxLength={160} aria-label={`Topic ${i + 1}`} onChange={(e) => updateTopic(i, { text: e.target.value })} />
            <select className="input" style={{ width: 'auto' }} value={t.kind} aria-label={`Topic ${i + 1} kind`} onChange={(e) => updateTopic(i, { kind: e.target.value as DraftTopic['kind'] })}>
              <option value="keyword">Keyword</option>
              <option value="skill">Skill</option>
            </select>
            <button type="button" className="btn btn-icon" aria-label="Remove topic" onClick={() => removeTopic(i)}><X /></button>
          </div>
        ))}
        <button type="button" className="btn btn-quiet" onClick={addTopic}><Plus /> Add a topic</button>
      </div>

      <FormError message={error} />
      <div className="btn-row" style={{ marginTop: 10 }}>
        <button type="button" className="btn btn-primary" onClick={() => void confirm()} disabled={busy || !d.title.trim()}>{busy ? 'Confirming…' : 'Confirm'}</button>
      </div>
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

  const inProgress = a?.status === 'reading' || a?.status === 'searching';
  useEffect(() => {
    if (!inProgress) return;
    const t = setInterval(() => void load(), 2000);
    return () => clearInterval(t);
  }, [inProgress, load]);

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
        {a?.status === 'searching' && <Searching a={a} />}
        {a?.status === 'failed' && <Failed a={a} onRetry={() => void retry()} onDelete={() => setConfirmDelete(true)} busy={busy} error={error} />}
        {a?.status === 'needs_check' && <ConfirmForm a={a} onConfirmed={(updated) => { setA(updated); toast('Assessment confirmed'); }} />}
        {a?.status === 'ready' && <Folder a={a} />}
        {a?.status === 'confirmed' && <Confirmed a={a} />}
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

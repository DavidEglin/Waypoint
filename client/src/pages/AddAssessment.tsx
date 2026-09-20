import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { MAX_UPLOAD_BYTES, READ_ERROR_TEXT, type CanvasFoundResponse, type CourseInfo, type ReadErrorCode } from '@waypoint/shared';
import { ApiFailure, api, errorMessage } from '../api';
import { Alert, Camera, FileText, Info } from '../components/Icons';
import { FormError } from '../components/ui';
import { countdown, formatBytes, formatDue } from '../format';
import { prepareImage } from '../prepareImage';
import { useConnections } from '../useConnections';

const ACCEPT = 'image/jpeg,image/png,image/webp,application/pdf,.pdf,.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document';

function CanvasList({ found, error, adding, onAdd }: { found: CanvasFoundResponse | null; error: string | null; adding: string | null; onAdd(courseId: number, id: string): void }) {
  if (error) return <FormError message={error} />;
  if (!found) return <p className="mono" role="status">Looking in Canvas…</p>;
  if (found.items.length === 0) return <p className="card-sub">Nothing upcoming was found in your Canvas courses. You can still upload a notification.</p>;
  return (
    <ul className="found-list">
      {found.items.map((i) => {
        const key = `${i.courseId}:${i.canvasAssignmentId}`;
        return (
          <li key={key}>
            <div>
              <p className="kicker">{i.courseName}</p>
              <p className="found-name">{i.name}</p>
              {i.dueAt && <p className="mono">{countdown(i.dueAt)} · {formatDue(i.dueAt, true)}</p>}
            </div>
            {i.addedAssessmentId ? (
              <Link className="btn" to={`/assessments/${i.addedAssessmentId}`} aria-label={`Open ${i.name}`}>Open</Link>
            ) : (
              <button className="btn btn-primary" disabled={adding !== null} onClick={() => onAdd(i.courseId, i.canvasAssignmentId)} aria-label={`Add ${i.name}`}>
                {adding === key ? 'Adding…' : 'Add'}
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function AddAssessment() {
  const navigate = useNavigate();
  const { data: connections } = useConnections();
  const [found, setFound] = useState<CanvasFoundResponse | null>(null);
  const [foundError, setFoundError] = useState<string | null>(null);
  const [courses, setCourses] = useState<CourseInfo[]>([]);
  const [adding, setAdding] = useState<string | null>(null);
  const [canvasActionError, setCanvasActionError] = useState<string | null>(null);

  const [file, setFile] = useState<File | null>(null);
  const [courseId, setCourseId] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);

  const canvasConnected = connections?.canvas.connected;
  const claudeConnected = connections?.claude.connected;

  useEffect(() => {
    void api<CourseInfo[]>('GET', '/api/courses').then(setCourses).catch(() => {});
  }, []);

  useEffect(() => {
    if (!canvasConnected) return;
    let cancelled = false;
    api<CanvasFoundResponse>('GET', '/api/canvas/assessments')
      .then((r) => { if (!cancelled) { setFound(r); setCourses(r.courses); } })
      .catch((e) => {
        if (cancelled) return;
        const code = e instanceof ApiFailure ? (e.code as ReadErrorCode) : null;
        setFoundError(code && code in READ_ERROR_TEXT ? READ_ERROR_TEXT[code] : errorMessage(e));
      });
    return () => { cancelled = true; };
  }, [canvasConnected]);

  async function addFromCanvas(course: number, assignment: string) {
    setAdding(`${course}:${assignment}`);
    setCanvasActionError(null);
    try {
      const { id } = await api<{ id: number }>('POST', '/api/assessments/from-canvas', { courseId: course, canvasAssignmentId: assignment });
      navigate(`/assessments/${id}`);
    } catch (e) {
      if (e instanceof ApiFailure && e.code === 'already_added' && typeof e.data.assessmentId === 'number') {
        navigate(`/assessments/${e.data.assessmentId}`);
        return;
      }
      setCanvasActionError(errorMessage(e));
      setAdding(null);
    }
  }

  function choose(picked: File | undefined) {
    setUploadError(null);
    if (!picked) return;
    if (/heic|heif/i.test(picked.type) || /\.hei[cf]$/i.test(picked.name)) {
      setFile(null);
      setUploadError('HEIC photos cannot be read yet. Use a JPEG or PNG. On an iPhone, take the photo with the button here and it will be converted for you.');
      return;
    }
    if (picked.size > MAX_UPLOAD_BYTES) {
      setFile(null);
      setUploadError(`That file is ${formatBytes(picked.size)}. The limit is ${formatBytes(MAX_UPLOAD_BYTES)}.`);
      return;
    }
    setFile(picked);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!file) return;
    setUploading(true);
    setUploadError(null);
    try {
      const ready = await prepareImage(file);
      const form = new FormData();
      if (courseId) form.append('courseId', courseId); // fields must come before the file
      form.append('file', ready, ready.name);
      const { id } = await api<{ id: number }>('POST', '/api/assessments', form);
      navigate(`/assessments/${id}`);
    } catch (err) {
      setUploadError(errorMessage(err));
      setUploading(false);
    }
  }

  return (
    <div className="page">
      <div className="page-head">
        <p className="kicker">Step 1 of 3</p>
        <h1>Add an assessment notification</h1>
        <p>Pick one Waypoint found in Canvas, or take a photo or upload the PDF or Word document your teacher gave you. Waypoint reads it and shows you what it found before doing anything else.</p>
      </div>

      {connections && !claudeConnected && (
        <p className="callout callout-error" role="alert" style={{ marginBottom: 20 }}>
          <Alert /> <span>Waypoint needs your Claude API key to read a notification. <Link to="/settings">Add it in Settings</Link>.</span>
        </p>
      )}

      <div className="add-grid">
        <section className="card" aria-labelledby="canvas-title">
          <div className="card-head"><div><h2 id="canvas-title">From Canvas</h2><p className="card-sub">Upcoming assignments in your courses.</p></div></div>
          {!connections ? <p className="mono" role="status">Loading…</p> : !canvasConnected ? (
            <p className="card-sub">Canvas is not connected yet. <Link to="/settings">Connect it in Settings</Link> to pick from your courses.</p>
          ) : (
            <>
              <FormError message={canvasActionError} />
              <CanvasList found={found} error={foundError} adding={adding} onAdd={(c, id) => void addFromCanvas(c, id)} />
            </>
          )}
        </section>

        <form className="card" onSubmit={submit} aria-labelledby="upload-title">
          <div className="card-head"><div><h2 id="upload-title">Upload it yourself</h2><p className="card-sub">A photo, PDF or Word document.</p></div></div>

          <div className="dropzone">
            <FileText className="dropzone-icon" />
            <p className="dropzone-text" aria-live="polite">
              {file ? <><strong>{file.name}</strong> <span className="mono">· {formatBytes(file.size)}</span></> : 'No file chosen yet'}
            </p>
          </div>

          <div className="btn-row" style={{ marginBottom: 16 }}>
            <button type="button" className="btn" onClick={() => cameraInput.current?.click()}><Camera /> Take a photo</button>
            <button type="button" className="btn" onClick={() => fileInput.current?.click()}><FileText /> Choose a file</button>
          </div>
          <input ref={cameraInput} type="file" accept="image/*" capture="environment" className="sr-only" tabIndex={-1} aria-label="Take a photo" onChange={(e) => { choose(e.target.files?.[0]); e.target.value = ''; }} />
          <input ref={fileInput} type="file" accept={ACCEPT} className="sr-only" tabIndex={-1} aria-label="Choose a file" onChange={(e) => { choose(e.target.files?.[0]); e.target.value = ''; }} />

          {courses.length > 0 && (
            <div className="field">
              <label htmlFor="course">Course <span className="hint">(optional)</span></label>
              <select id="course" className="input" value={courseId} onChange={(e) => setCourseId(e.target.value)}>
                <option value="">Work it out from the notification</option>
                {courses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
          )}

          <FormError message={uploadError} />
          <button className="btn btn-primary" disabled={!file || uploading || claudeConnected === false}>{uploading ? 'Uploading…' : 'Read this notification'}</button>
          <p className="hint privacy-note"><Info /> <span>Waypoint sends the notification to Claude, using your own key, to read it. The file is kept in your account so you can look at it again.</span></p>
        </form>
      </div>
    </div>
  );
}

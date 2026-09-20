import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { AssessmentStatus, AssessmentSummary } from '@waypoint/shared';
import { api, errorMessage } from '../api';
import { ArrowRight, Check, Compass, Plus } from '../components/Icons';
import { FormError } from '../components/ui';
import { countdown, formatDue } from '../format';
import { useConnections } from '../useConnections';

const STATUS: Record<AssessmentStatus, { label: string; tone: 'ok' | 'warn' | 'bad' | '' }> = {
  reading: { label: 'Reading…', tone: '' },
  needs_check: { label: 'Needs a check', tone: 'warn' },
  confirmed: { label: 'Confirmed', tone: 'ok' },
  searching: { label: 'Searching', tone: '' },
  ready: { label: 'Folder ready', tone: 'ok' },
  failed: { label: 'Could not read', tone: 'bad' },
};

function AssessmentCard({ a, past }: { a: AssessmentSummary; past: boolean }) {
  const s = STATUS[a.status];
  const due = a.nextDueAt ?? a.lastDueAt;
  return (
    <li>
      <Link to={`/assessments/${a.id}`} className={`card assessment-card${past ? ' is-past' : ''}`}>
        <div className="assessment-main">
          {a.courseName && <p className="kicker">{a.courseName}</p>}
          <h2>{a.title}</h2>
          <div className="assessment-meta">
            <span className={`chip${s.tone ? ` chip-${s.tone}` : ''}`}>{s.label}</span>
            {!due && a.status !== 'reading' && a.status !== 'failed' && <span className="mono">No due date found</span>}
          </div>
        </div>
        {due && (
          <div className="assessment-due">
            <span className="countdown">{countdown(due)}</span>
            <span className="mono">{formatDue(due, true)}</span>
          </div>
        )}
        <ArrowRight className="assessment-go" />
      </Link>
    </li>
  );
}

export function Home() {
  const { data: connections } = useConnections();
  const [items, setItems] = useState<AssessmentSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setItems(await api<AssessmentSummary[]>('GET', '/api/assessments'));
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  // While something is being read, check back every few seconds.
  const reading = items?.some((a) => a.status === 'reading');
  useEffect(() => {
    if (!reading) return;
    const t = setInterval(() => void load(), 3000);
    return () => clearInterval(t);
  }, [reading, load]);

  const upcoming = items?.filter((a) => a.nextDueAt || !a.lastDueAt) ?? [];
  const earlier = items?.filter((a) => !a.nextDueAt && a.lastDueAt) ?? [];
  const setupNeeded = connections && (!connections.canvas.connected || !connections.claude.connected);

  return (
    <div className="page">
      <div className="page-head page-head-row">
        <div>
          <p className="kicker">Upcoming</p>
          <h1>Assessments</h1>
          <p>Everything due soon, in date order.</p>
        </div>
        <Link className="btn btn-primary" to="/add"><Plus /> Add an assessment</Link>
      </div>

      <div className="stack">
        <FormError message={error} />
        {items === null && !error && <p className="mono" role="status">Loading…</p>}

        {items?.length === 0 && (
          <section className="card empty" aria-labelledby="empty-title">
            <Compass />
            <h2 id="empty-title">No assessments yet</h2>
            <p>Add an assessment notification and Waypoint will read it, then gather what you need to study into one folder.</p>
            <Link className="btn btn-primary" to="/add"><Plus /> Add an assessment</Link>
          </section>
        )}

        {upcoming.length > 0 && <ul className="assessments" aria-label="Upcoming assessments">{upcoming.map((a) => <AssessmentCard key={a.id} a={a} past={false} />)}</ul>}
        {earlier.length > 0 && (
          <section aria-labelledby="earlier-title">
            <h2 id="earlier-title" className="section-title">Earlier</h2>
            <ul className="assessments">{earlier.map((a) => <AssessmentCard key={a.id} a={a} past />)}</ul>
          </section>
        )}

        {setupNeeded && (
          <section className="card" aria-labelledby="setup-title">
            <div className="card-head">
              <div>
                <h2 id="setup-title">Get set up</h2>
                <p className="card-sub">Waypoint needs your Claude key to read a notification, and Canvas to find your course material.</p>
              </div>
            </div>
            <ul className="setup-list">
              <li>
                <span>Add your Claude API key</span>
                {connections.claude.connected ? <span className="chip chip-ok"><Check /> Connected</span> : <Link className="btn" to="/settings">Set up</Link>}
              </li>
              <li>
                <span>Connect Canvas</span>
                {connections.canvas.connected ? <span className="chip chip-ok"><Check /> Connected</span> : <Link className="btn" to="/settings">Set up</Link>}
              </li>
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}

import { Link } from 'react-router-dom';
import { Check, Compass } from '../components/Icons';
import { useConnections } from '../useConnections';

// Milestone 1 shell: the real assessment cards arrive with the add/read/confirm flow (M2 to M4).
export function Home() {
  const { data } = useConnections();
  const canvas = data?.canvas.connected;
  const claude = data?.claude.connected;

  return (
    <div className="page">
      <div className="page-head">
        <p className="kicker">Upcoming</p>
        <h1>Assessments</h1>
        <p>Everything due soon, in date order.</p>
      </div>

      <div className="stack">
        <section className="card empty" aria-labelledby="empty-title">
          <Compass />
          <h2 id="empty-title">No assessments yet</h2>
          <p>Once you connect Canvas and add an assessment notification, Waypoint will gather what you need to study into one folder.</p>
        </section>

        <section className="card" aria-labelledby="setup-title">
          <div className="card-head">
            <div>
              <h2 id="setup-title">Get set up</h2>
              <p className="card-sub">Waypoint needs both to read a notification and find your course material.</p>
            </div>
          </div>
          <ul className="setup-list">
            <li>
              <span>Connect Canvas</span>
              {data ? (canvas ? <span className="chip chip-ok"><Check /> Connected</span> : <Link className="btn" to="/settings">Set up</Link>) : <span className="mono">Checking…</span>}
            </li>
            <li>
              <span>Add your Claude API key</span>
              {data ? (claude ? <span className="chip chip-ok"><Check /> Connected</span> : <Link className="btn" to="/settings">Set up</Link>) : <span className="mono">Checking…</span>}
            </li>
          </ul>
        </section>
      </div>
    </div>
  );
}

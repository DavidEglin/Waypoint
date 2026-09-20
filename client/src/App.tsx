import { Navigate, NavLink, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth';
import { BrandMark } from './components/Icons';
import { AddAssessment } from './pages/AddAssessment';
import { AdminUsers } from './pages/AdminUsers';
import { AssessmentPage } from './pages/AssessmentPage';
import { ChangePassword } from './pages/ChangePassword';
import { Home } from './pages/Home';
import { Settings } from './pages/Settings';
import { SignIn } from './pages/SignIn';

function Shell({ children }: { children: React.ReactNode }) {
  const { user, signOut } = useAuth();
  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <NavLink to="/" className="brand" aria-label="Waypoint home">
            <BrandMark /> Waypoint
          </NavLink>
          <nav className="nav" aria-label="Main">
            <NavLink to="/" end>Assessments</NavLink>
            <NavLink to="/settings">Settings</NavLink>
            {user?.role === 'admin' && <NavLink to="/admin/users">Users</NavLink>}
          </nav>
          <div className="who">
            <span className="who-name">{user?.username}</span>
            <button className="btn btn-quiet" onClick={() => void signOut()}>Sign out</button>
          </div>
        </div>
      </header>
      <main>{children}</main>
    </>
  );
}

export function App() {
  const { user } = useAuth();

  if (user === undefined) return <div className="center-screen" role="status" aria-live="polite"><span className="mono">Loading…</span></div>;
  if (user === null) return <SignIn />;
  if (user.mustChangePassword) return <ChangePassword forced />;

  return (
    <Shell>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/add" element={<AddAssessment />} />
        <Route path="/assessments/:id" element={<AssessmentPage />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/admin/users" element={user.role === 'admin' ? <AdminUsers /> : <Navigate to="/" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Shell>
  );
}

import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, NavLink, Route, Routes } from 'react-router-dom';
import './styles.css';
import Clients from './pages/Clients';
import ClientDetail from './pages/ClientDetail';
import EmployeeEditor from './pages/EmployeeEditor';
import PayRun from './pages/PayRun';
import PayRunView from './pages/PayRunView';
import Research from './pages/Research';
import Calculator from './pages/Calculator';
import Vendors from './pages/Vendors';
import Multiples from './pages/Multiples';
import Proposals from './pages/Proposals';
import ProposalBuilder from './pages/ProposalBuilder';
import Admin from './pages/Admin';
import PublicReport from './pages/Report';
import { api } from './api';
import { AuthProvider, Login, LogoOrName, useAuth } from './auth';

type Theme = 'system' | 'light' | 'dark';
const readTheme = (): Theme => { try { return (localStorage.getItem('theme') as Theme) || 'system'; } catch { return 'system'; } };
const applyTheme = (t: Theme) => { if (t === 'system') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = t; };
applyTheme(readTheme());

/** Light / dark / follow the computer's setting; remembered in this browser. */
function ThemeSwitch() {
  const [theme, setTheme] = React.useState<Theme>(readTheme);
  const pick = (t: Theme) => { setTheme(t); applyTheme(t); try { localStorage.setItem('theme', t); } catch { /* private window */ } };
  return (
    <div className="fg-seg theme" role="group" aria-label="Theme">
      {(['light', 'system', 'dark'] as Theme[]).map((t) => <button key={t} aria-pressed={theme === t} onClick={() => pick(t)}>{t === 'light' ? 'Light' : t === 'dark' ? 'Dark' : 'Auto'}</button>)}
    </div>
  );
}

const icon = (d: string) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>;
// [path, label, icon, end, permissions (any one shows the tab)]
const NAV: [string, string, string, boolean, string[]][] = [
  ['/', 'Clients', 'M3 21V7l9-4 9 4v14M9 21v-6h6v6M8 10h.01M12 10h.01M16 10h.01', true, ['clients.view']],
  ['/proposals', 'Proposals', 'M4 20V10M10 20V4M16 20v-7M22 20H2', false, ['proposals.view']],
  ['/calculator', 'Paycheck calculator', 'M6 2h12a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zM8 6h8M8 11h.01M12 11h.01M16 11h.01M8 15h.01M12 15h.01M16 15h.01M8 19h8', false, []],
  ['/research', 'Tax database', 'M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3zM4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6', false, []],
  ['/multiples', 'Valuation multiples', 'M3 3v18h18M7 15l4-5 3 3 5-7', false, ['proposals.view']],
  ['/vendors', 'Vendor profiles', 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8', false, ['clients.view']],
  ['/admin', 'Admin', 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z', false, ['users.manage', 'audit.view']],
];

function UserBlock() {
  const { user, actor, reload } = useAuth();
  const [pw, setPw] = React.useState(false);
  const [f, setF] = React.useState({ current: '', next: '' });
  const [msg, setMsg] = React.useState('');
  if (!user || !actor) return null;
  const signOut = async () => { await api('/auth/logout', { method: 'POST' }).catch(() => {}); await reload(); };
  const change = async (e: React.FormEvent) => {
    e.preventDefault(); setMsg('');
    try { await api('/auth/password', { json: { current: f.current, next: f.next } }); setMsg('Password changed.'); setF({ current: '', next: '' }); setPw(false); } catch (x: any) { setMsg(x.message); }
  };
  return (
    <div className="fg-user">
      <b>{actor.name}</b>
      <span className="muted small">{actor.role[0].toUpperCase() + actor.role.slice(1)}</span>
      <span className="row" style={{ gap: 12 }}>
        <button className="fg-link" onClick={signOut}>Sign out</button>
        <button className="fg-link" onClick={() => setPw(!pw)}>Change password</button>
      </span>
      {pw && (
        <form onSubmit={change} style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6 }}>
          <input type="password" placeholder="Current password" autoComplete="current-password" value={f.current} onChange={(e) => setF({ ...f, current: e.target.value })} />
          <input type="password" placeholder="New password (10+ characters)" autoComplete="new-password" minLength={10} value={f.next} onChange={(e) => setF({ ...f, next: e.target.value })} />
          <button className="small primary">Save password</button>
        </form>
      )}
      {msg && <span className="small">{msg}</span>}
    </div>
  );
}

/** Shows the server's reason when it refuses an action, so a read-only user is never left with a silent button. */
function Refused() {
  const [msg, setMsg] = React.useState('');
  React.useEffect(() => {
    let t: ReturnType<typeof setTimeout>;
    const h = (e: Event) => { setMsg(String((e as CustomEvent).detail)); clearTimeout(t); t = setTimeout(() => setMsg(''), 8000); };
    window.addEventListener('auth:forbidden', h);
    return () => { window.removeEventListener('auth:forbidden', h); clearTimeout(t); };
  }, []);
  if (!msg) return null;
  return <div className="fg-refused noprint" role="alert"><span>{msg}</span><button className="fg-link" onClick={() => setMsg('')}>Dismiss</button></div>;
}

function ViewAsBanner() {
  const { user, actor, impersonating, reload } = useAuth();
  if (!impersonating || !user) return null;
  const stop = async () => { await api('/auth/stop-impersonating', { method: 'POST' }); await reload(); window.location.assign('/admin'); };
  return (
    <div className="fg-viewas noprint" role="status">
      <span>Viewing as <b>{user.name}</b> ({user.role}). Anything you change is logged as {actor?.name} acting as {user.name}.</span>
      <button onClick={stop}>Stop viewing as</button>
    </div>
  );
}

function Shell() {
  const { user, loading } = useAuth();
  if (loading) return <div className="fg-login"><span className="muted">Loading…</span></div>;
  if (!user) return <Login />;
  const has = (perms: string[]) => !perms.length || perms.some((p) => user.permissions.includes(p));
  return (
    <>
      <div className="fg-rule" aria-hidden="true"><span /><span /><span /><span /></div>
      <ViewAsBanner />
      <div className="layout">
        <nav className="fg-side" aria-label="Main">
          <LogoOrName small />
          {NAV.filter((n) => has(n[4])).map(([to, label, d, end]) => <NavLink key={to} to={to} end={end} className="fg-tab">{icon(d)}{label}</NavLink>)}
          <div className="fg-side-foot">
            <UserBlock />
            <span className="fg-status">Tax year 2027 data</span>
            <ThemeSwitch />
          </div>
        </nav>
        <main>
          <Refused />
          <Routes>
            <Route path="/" element={<Clients />} />
            <Route path="/clients/:id" element={<ClientDetail />} />
            <Route path="/clients/:id/employees/new" element={<EmployeeEditor />} />
            <Route path="/employees/:employeeId" element={<EmployeeEditor />} />
            <Route path="/clients/:id/payrun" element={<PayRun />} />
            <Route path="/payruns/:runId" element={<PayRunView />} />
            <Route path="/proposals" element={<Proposals />} />
            <Route path="/proposals/new" element={<ProposalBuilder key="new" />} />
            <Route path="/proposals/:id" element={<ProposalBuilder />} />
            <Route path="/calculator" element={<Calculator />} />
            <Route path="/research" element={<Research />} />
            <Route path="/vendors" element={<Vendors />} />
            <Route path="/multiples" element={<Multiples />} />
            <Route path="/admin" element={has(['users.manage', 'audit.view']) ? <Admin /> : <p className="muted">You don't have access to this page.</p>} />
          </Routes>
        </main>
      </div>
    </>
  );
}

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/r/:slug" element={<PublicReport />} />
        <Route path="*" element={<AuthProvider><Shell /></AuthProvider>} />
      </Routes>
    </BrowserRouter>
  );
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);

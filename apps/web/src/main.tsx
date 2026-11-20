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
import Proposals from './pages/Proposals';
import ProposalBuilder from './pages/ProposalBuilder';

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

/** First Gen wordmark from apps/web/public/brand (never rebuilt); plain text until the files are added. */
function Brand() {
  const [hasLogo, setHasLogo] = React.useState(true);
  return (
    <div className="fg-brand">
      {hasLogo ? (
        <>
          <img className="fg-logo-light" src="/brand/first-gen-wordmark-light.png" alt="First Gen" width={156} height={26} onError={() => setHasLogo(false)} />
          <img className="fg-logo-dark" src="/brand/first-gen-wordmark-dark.png" alt="First Gen" width={156} height={26} onError={() => setHasLogo(false)} />
        </>
      ) : <span className="fg-app">First Gen</span>}
      <span className="fg-appname">Payroll Tax Engine</span>
    </div>
  );
}

const icon = (d: string) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>;
const NAV: [string, string, string, boolean?][] = [
  ['/', 'Clients', 'M3 21V7l9-4 9 4v14M9 21v-6h6v6M8 10h.01M12 10h.01M16 10h.01', true],
  ['/proposals', 'Proposal tool', 'M4 20V10M10 20V4M16 20v-7M22 20H2'],
  ['/calculator', 'Paycheck calculator', 'M6 2h12a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zM8 6h8M8 11h.01M12 11h.01M16 11h.01M8 15h.01M12 15h.01M16 15h.01M8 19h8'],
  ['/research', 'Tax database', 'M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3zM4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6'],
  ['/vendors', 'Vendor profiles', 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8'],
];

function App() {
  return (
    <BrowserRouter>
      <div className="fg-rule" aria-hidden="true"><span /><span /><span /><span /></div>
      <div className="layout">
        <nav className="fg-side" aria-label="Main">
          <Brand />
          {NAV.map(([to, label, d, end]) => <NavLink key={to} to={to} end={end} className="fg-tab">{icon(d)}{label}</NavLink>)}
          <div className="fg-side-foot">
            <span className="fg-status">Tax year 2027 data</span>
            <ThemeSwitch />
          </div>
        </nav>
        <main>
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
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);

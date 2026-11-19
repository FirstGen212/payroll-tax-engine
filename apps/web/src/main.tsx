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
    <div className="seg theme noprint" role="group" aria-label="Theme">
      {(['light', 'system', 'dark'] as Theme[]).map((t) => <button key={t} className={theme === t ? 'on' : ''} onClick={() => pick(t)}>{t === 'light' ? 'Light' : t === 'dark' ? 'Dark' : 'Auto'}</button>)}
    </div>
  );
}

function App() {
  return (
    <BrowserRouter>
      <div className="layout">
        <nav className="side">
          <h1>Payroll Tax Engine</h1>
          <NavLink to="/" end>Clients</NavLink>
          <NavLink to="/proposals">Proposal tool</NavLink>
          <NavLink to="/calculator">Paycheck calculator</NavLink>
          <NavLink to="/research">Tax database</NavLink>
          <NavLink to="/vendors">Vendor profiles</NavLink>
          <ThemeSwitch />
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

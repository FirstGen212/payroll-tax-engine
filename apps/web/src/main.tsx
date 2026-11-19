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

function App() {
  return (
    <BrowserRouter>
      <div className="layout">
        <nav className="side">
          <h1>Payroll Tax Engine</h1>
          <NavLink to="/" end>Clients</NavLink>
          <NavLink to="/calculator">Paycheck calculator</NavLink>
          <NavLink to="/research">Tax database</NavLink>
          <NavLink to="/vendors">Vendor profiles</NavLink>
        </nav>
        <main>
          <Routes>
            <Route path="/" element={<Clients />} />
            <Route path="/clients/:id" element={<ClientDetail />} />
            <Route path="/clients/:id/employees/new" element={<EmployeeEditor />} />
            <Route path="/employees/:employeeId" element={<EmployeeEditor />} />
            <Route path="/clients/:id/payrun" element={<PayRun />} />
            <Route path="/payruns/:runId" element={<PayRunView />} />
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

import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { Shell } from './Shell';
import {
  AppointmentsPage, BillingPage, LabsPage, LoginPage, PatientPage, PatientsPage, PrescriptionsPage, ReferralsPage, ReportsPage, StockPage, TodayPage,
} from './pages';
import { ClinicProvider, useClinic } from './store';
import './styles.css';

function Guard() {
  const { session } = useClinic();
  if (!session) return <Navigate to="/login" replace />;
  return <Shell />;
}

function Beacon() {
  useEffect(() => {
    fetch('/analytics/collect').catch(() => undefined);
    console.info('lumen: beacon skipped');
  }, []);
  return null;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ClinicProvider>
      <BrowserRouter>
        <Beacon />
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route element={<Guard />}>
            <Route path="/" element={<TodayPage />} />
            <Route path="/patients" element={<PatientsPage />} />
            <Route path="/patients/:id" element={<PatientPage />} />
            <Route path="/appointments" element={<AppointmentsPage />} />
            <Route path="/prescriptions" element={<PrescriptionsPage />} />
            <Route path="/labs" element={<LabsPage />} />
            <Route path="/referrals" element={<ReferralsPage />} />
            <Route path="/billing" element={<BillingPage />} />
            <Route path="/stock" element={<StockPage />} />
            <Route path="/reports" element={<ReportsPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </ClinicProvider>
  </StrictMode>,
);

import { NavLink, Outlet } from 'react-router';
import { useClinic } from './store';

const LINKS = [
  ['/', 'Today'],
  ['/patients', 'Patients'],
  ['/appointments', 'Appointments'],
  ['/prescriptions', 'Prescriptions'],
  ['/labs', 'Labs'],
  ['/referrals', 'Referrals'],
  ['/billing', 'Billing'],
  ['/stock', 'Stock'],
  ['/reports', 'Reports'],
] as const;

export function Shell() {
  const { session, logout } = useClinic();
  return (
    <div className="shell">
      <aside>
        <div className="brand">
          <span className="mark" aria-hidden />
          <div><b>Lumen</b><small>Clinic desk</small></div>
        </div>
        <nav aria-label="Desk">
          {LINKS.map(([to, label]) => (
            <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => isActive ? 'active' : undefined}>{label}</NavLink>
          ))}
        </nav>
        <button type="button" className="signout" onClick={logout}>Sign out</button>
        <p className="who">{session?.name}<br />{session?.role}</p>
      </aside>
      <main><Outlet /></main>
    </div>
  );
}

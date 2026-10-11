import { useState } from 'react';
import { Link, Navigate, useParams } from 'react-router';
import { LOW_AT, money } from './model';
import { useClinic } from './store';
import { Field, Panel, Status } from './ui';

export function LoginPage() {
  const { session, login } = useClinic();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  if (session) return <Navigate to="/" replace />;
  return (
    <main className="gate">
      <form className="gate-card" onSubmit={e => { e.preventDefault(); setError(login(email, password)); }}>
        <p className="eyebrow">Lumen Clinic</p>
        <h1>Sign in</h1>
        <p className="lede">Desk for the clinic day of 11 October 2026.</p>
        <Field label="Email">
          <input value={email} autoComplete="username" onChange={e => setEmail(e.target.value)} />
        </Field>
        <Field label="Password">
          <input type="password" value={password} autoComplete="current-password" onChange={e => setPassword(e.target.value)} />
        </Field>
        <button type="submit" className="primary">Sign in</button>
        <Status text={error} />
      </form>
    </main>
  );
}

export function TodayPage() {
  const { session, patients, appointments } = useClinic();
  const next = [...appointments].sort((a, b) => a.time.localeCompare(b.time))[0];
  const who = next ? patients.find(p => p.id === next.patientId) : undefined;
  return (
    <>
      <header className="page-head">
        <p className="eyebrow">Clinic day · 11 October 2026</p>
        <h1>Today</h1>
      </header>
      <div className="stats">
        <article><b>{patients.length}</b><span>Patients on file</span></article>
        <article><b>{appointments.length}</b><span>Appointments</span></article>
        <article><b>{session?.role === 'manager' ? 'Manager' : 'Employee'}</b><span>Desk role</span></article>
      </div>
      <section className="board" aria-label="Board">
        <p>Signed in as {session?.name}</p>
        {who && next ? <p>Next: {who.name} at {next.time}</p> : <p>No appointments on the book.</p>}
        {appointments.some(a => a.status === 'Arrived') && (
          <p>Waiting: {appointments.filter(a => a.status === 'Arrived').map(a => patients.find(p => p.id === a.patientId)?.name).filter(Boolean).join(', ')}</p>
        )}
        <p>The board lists the morning book. Billing and stock changes stay with the manager.</p>
      </section>
    </>
  );
}

export function PatientsPage() {
  const clinic = useClinic();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [name, setName] = useState('');
  const [mrn, setMrn] = useState('');
  const [dob, setDob] = useState('');
  const [phone, setPhone] = useState('');
  const q = query.trim();
  const shown = clinic.patients.filter(p => !q || `${p.name} ${p.mrn}`.includes(q));
  const count = `${shown.length} ${shown.length === 1 ? 'patient' : 'patients'}`;
  return (
    <>
      <header className="page-head row">
        <div><p className="eyebrow">Records</p><h1>Patients</h1></div>
        <button type="button" className="primary" onClick={() => { setOpen(true); clinic.clearStatus(); }}>Add patient</button>
      </header>
      <Status text={clinic.status} />
      <Field label="Search patients">
        <input value={query} onChange={e => setQuery(e.target.value)} />
      </Field>
      <p className="count">{count}</p>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Name</th><th>MRN</th><th>Phone</th></tr></thead>
          <tbody>
            {shown.map(p => (
              <tr key={p.id}>
                <td><Link to={`/patients/${p.id}`}>{p.name}</Link></td>
                <td className="num">{p.mrn}</td>
                <td>{p.phone}</td>
              </tr>
            ))}
            {shown.length === 0 && <tr><td colSpan={3}>No patient matches.</td></tr>}
          </tbody>
        </table>
      </div>
      {open && (
        <form className="drawer" onSubmit={e => {
          e.preventDefault();
          if (clinic.addPatient({ name, mrn, dob, phone })) { setOpen(false); setName(''); setMrn(''); setDob(''); setPhone(''); }
        }}>
          <h2>New patient</h2>
          <Field label="Full name"><input value={name} onChange={e => setName(e.target.value)} /></Field>
          <Field label="MRN"><input value={mrn} onChange={e => setMrn(e.target.value)} /></Field>
          <Field label="Date of birth"><input value={dob} placeholder="YYYY-MM-DD" onChange={e => setDob(e.target.value)} /></Field>
          <Field label="Phone"><input value={phone} onChange={e => setPhone(e.target.value)} /></Field>
          <div className="actions">
            <button type="submit" className="primary">Save patient</button>
            <button type="button" onClick={() => setOpen(false)}>Close</button>
          </div>
        </form>
      )}
    </>
  );
}

export function PatientPage() {
  const { id = '' } = useParams();
  const clinic = useClinic();
  const patient = clinic.patients.find(p => p.id === id);
  const [followOpen, setFollowOpen] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [followDate, setFollowDate] = useState('');
  const [note, setNote] = useState('');
  const [removing, setRemoving] = useState<string | null>(null);
  if (!patient) return <p>That patient is not on file. <Link to="/patients">Back to patients</Link></p>;
  const notes = clinic.notes.filter(item => item.patientId.startsWith('p-'));
  return (
    <>
      <header className="page-head row">
        <div>
          <p className="eyebrow">MRN {patient.mrn}</p>
          <h1>{patient.name}</h1>
        </div>
        <div className="actions">
          <button type="button" className="primary" onClick={() => { setFollowOpen(true); setNoteOpen(false); clinic.clearStatus(); }}>Plan follow-up</button>
          <button type="button" onClick={() => { setNoteOpen(true); setFollowOpen(false); clinic.clearStatus(); }}>Add note</button>
        </div>
      </header>
      <Status text={clinic.status} />
      <section className="record" aria-label="Record">
        <p>MRN {patient.mrn}</p>
        <p>Born {patient.dob}</p>
        <p>Phone: {patient.phone}</p>
        <p>Follow-up: {patient.followUp}</p>
        <p>Allergy: {patient.allergies.length ? patient.allergies.join(', ') : 'none'}</p>
        {patient.allergies.map(allergy => (
          <button key={allergy} type="button" onClick={() => { setRemoving(allergy); clinic.clearStatus(); }}>Remove {allergy}</button>
        ))}
      </section>
      <section className="record">
        <h2>Notes</h2>
        {notes.length === 0 && <p>No notes yet.</p>}
        {notes.map(item => <p key={item.id}>{item.text}</p>)}
      </section>
      {followOpen && (
        <form className="drawer" onSubmit={e => {
          e.preventDefault();
          if (clinic.setFollowUp(patient.id, followDate)) { setFollowOpen(false); setFollowDate(''); }
        }}>
          <h2>Plan follow-up</h2>
          <Field label="Follow-up date"><input value={followDate} placeholder="YYYY-MM-DD" onChange={e => setFollowDate(e.target.value)} /></Field>
          <div className="actions">
            <button type="submit" className="primary">Save follow-up</button>
            <button type="button" onClick={() => setFollowOpen(false)}>Close</button>
          </div>
        </form>
      )}
      {noteOpen && (
        <form className="drawer" onSubmit={e => {
          e.preventDefault();
          if (clinic.addNote(patient.id, note)) { setNoteOpen(false); setNote(''); }
        }}>
          <h2>Add note</h2>
          <Field label="Note"><input value={note} onChange={e => setNote(e.target.value)} /></Field>
          <div className="actions">
            <button type="submit" className="primary">Save note</button>
            <button type="button" onClick={() => setNoteOpen(false)}>Close</button>
          </div>
        </form>
      )}
      {removing && (
        <div className="dialog" role="dialog" aria-labelledby="allergy-title">
          <h2 id="allergy-title">Remove this allergy?</h2>
          <p>{removing} comes off the record.</p>
          <div className="actions">
            <button type="button" className="danger" onClick={() => { clinic.removeAllergy(patient.id, removing); setRemoving(null); }}>Remove allergy</button>
            <button type="button" onClick={() => setRemoving(null)}>Keep allergy</button>
          </div>
        </div>
      )}
    </>
  );
}

export function AppointmentsPage() {
  const clinic = useClinic();
  const [open, setOpen] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [patientId, setPatientId] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [clinician, setClinician] = useState('');
  const rows = [...clinic.appointments].sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  return (
    <>
      <header className="page-head row">
        <div><p className="eyebrow">Book</p><h1>Appointments</h1></div>
        <button type="button" className="primary" onClick={() => { setOpen(true); clinic.clearStatus(); }}>Book appointment</button>
      </header>
      <Status text={clinic.status} />
      <ul className="list">
        {rows.map(a => {
          const patient = clinic.patients.find(p => p.id === a.patientId);
          const label = `${a.time} ${patient?.name ?? 'Unknown'}`;
          return (
            <li key={a.id}>
              <div>
                <b className="num">{a.time}</b> {patient?.name} · {a.clinician} · {a.reason} · {a.status}
                <div className="muted">{a.date}</div>
              </div>
              <div className="actions">
                {a.status === 'Booked' && <button type="button" onClick={() => { clinic.checkIn(a.id); }}>Check in {label}</button>}
                <button type="button" onClick={() => setConfirmId(a.id)}>Delete {label}</button>
              </div>
            </li>
          );
        })}
        {rows.length === 0 && <li>No appointments on the book.</li>}
      </ul>
      {open && (
        <form className="drawer" onSubmit={e => {
          e.preventDefault();
          if (clinic.book({ patientId, date, time, clinician })) { setOpen(false); setPatientId(''); setDate(''); setTime(''); setClinician(''); }
        }}>
          <h2>Book a visit</h2>
          <Field label="Patient">
            <select value={patientId} onChange={e => setPatientId(e.target.value)}>
              <option value="">Choose a patient</option>
              {clinic.patients.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </Field>
          <Field label="Date"><input value={date} placeholder="YYYY-MM-DD" onChange={e => setDate(e.target.value)} /></Field>
          <Field label="Time"><input value={time} placeholder="HH:MM" onChange={e => setTime(e.target.value)} /></Field>
          <Field label="Clinician"><input value={clinician} onChange={e => setClinician(e.target.value)} /></Field>
          <div className="actions">
            <button type="submit" className="primary">Save appointment</button>
            <button type="button" onClick={() => setOpen(false)}>Close</button>
          </div>
        </form>
      )}
      {confirmId && (
        <div className="dialog" role="dialog" aria-labelledby="delete-title">
          <h2 id="delete-title">Delete this appointment?</h2>
          <p>The visit comes off the book. This cannot be undone in the desk.</p>
          <div className="actions">
            <button type="button" className="danger" onClick={() => { clinic.deleteAppointment(confirmId); setConfirmId(null); }}>Delete appointment</button>
            <button type="button" onClick={() => setConfirmId(null)}>Keep appointment</button>
          </div>
        </div>
      )}
    </>
  );
}

export function PrescriptionsPage() {
  const clinic = useClinic();
  const [open, setOpen] = useState(false);
  const [patientId, setPatientId] = useState('');
  const [medicine, setMedicine] = useState('');
  const [dose, setDose] = useState('');
  return (
    <>
      <header className="page-head row">
        <div><p className="eyebrow">Orders</p><h1>Prescriptions</h1></div>
        <button type="button" className="primary" onClick={() => {
          clinic.clearStatus();
          if (clinic.session?.role !== 'manager') { clinic.prescribe({ patientId: '', medicine: '', dose: '' }); return; }
          setOpen(true);
        }}>New prescription</button>
      </header>
      <Status text={clinic.status} />
      <ul className="list">
        {clinic.prescriptions.map(rx => {
          const patient = clinic.patients.find(p => p.id === rx.patientId);
          return <li key={rx.id}><div><b>{rx.medicine}</b> · {rx.dose}<div className="muted">{patient?.name}</div></div></li>;
        })}
        {clinic.prescriptions.length === 0 && <li>No prescriptions this session.</li>}
      </ul>
      {open && (
        <form className="drawer" onSubmit={e => {
          e.preventDefault();
          if (clinic.prescribe({ patientId, medicine, dose })) { setOpen(false); setPatientId(''); setMedicine(''); setDose(''); }
        }}>
          <h2>New prescription</h2>
          <Field label="Patient">
            <select value={patientId} onChange={e => setPatientId(e.target.value)}>
              <option value="">Choose a patient</option>
              {clinic.patients.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </Field>
          <Field label="Medicine"><input value={medicine} onChange={e => setMedicine(e.target.value)} /></Field>
          <Field label="Dose"><input value={dose} onChange={e => setDose(e.target.value)} /></Field>
          <div className="actions">
            <button type="submit" className="primary">Save prescription</button>
            <button type="button" onClick={() => setOpen(false)}>Close</button>
          </div>
        </form>
      )}
    </>
  );
}

export function BillingPage() {
  const clinic = useClinic();
  const [paying, setPaying] = useState<string | null>(null);
  const [method, setMethod] = useState('');
  const [raising, setRaising] = useState(false);
  const [patientId, setPatientId] = useState('');
  const [amount, setAmount] = useState('');
  if (clinic.session?.role !== 'manager') {
    return (
      <>
        <header className="page-head"><h1>Billing</h1></header>
        <p className="denied">You do not have access to billing.</p>
      </>
    );
  }
  return (
    <>
      <header className="page-head row">
        <div><p className="eyebrow">Money</p><h1>Billing</h1></div>
        <button type="button" className="primary" onClick={() => { setRaising(true); setPaying(null); clinic.clearStatus(); }}>New invoice</button>
      </header>
      <Status text={clinic.status} />
      {clinic.status.startsWith('Paid ') && <p className="mailbox">Mailbox: receipt queued.</p>}
      <div className="table-wrap">
        <table>
          <thead><tr><th>Invoice</th><th>Patient</th><th>Amount</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {clinic.invoices.map(inv => {
              const patient = clinic.patients.find(p => p.id === inv.patientId);
              return (
                <tr key={inv.id}>
                  <td className="num">{inv.id}</td>
                  <td>{patient?.name}</td>
                  <td className="num">{money(inv.amount)}</td>
                  <td>{inv.status}</td>
                  <td>{inv.status === 'Unpaid' && <button type="button" onClick={() => { setPaying(inv.id); setMethod(''); clinic.clearStatus(); }}>Pay {inv.id}</button>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {paying && (
        <form className="drawer" onSubmit={e => {
          e.preventDefault();
          if (clinic.pay(paying, method)) setPaying(null);
        }}>
          <h2>Take payment</h2>
          <Field label="Method"><input value={method} onChange={e => setMethod(e.target.value)} /></Field>
          <div className="actions">
            <button type="submit" className="primary">Pay invoice</button>
            <button type="button" onClick={() => setPaying(null)}>Close</button>
          </div>
        </form>
      )}
      {raising && (
        <form className="drawer" onSubmit={e => {
          e.preventDefault();
          if (clinic.raiseInvoice({ patientId, amount })) { setRaising(false); setPatientId(''); setAmount(''); }
        }}>
          <h2>New invoice</h2>
          <Field label="Patient">
            <select value={patientId} onChange={e => setPatientId(e.target.value)}>
              <option value="">Choose a patient</option>
              {clinic.patients.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </Field>
          <Field label="Amount"><input value={amount} onChange={e => setAmount(e.target.value)} /></Field>
          <div className="actions">
            <button type="submit" className="primary">Save invoice</button>
            <button type="button" onClick={() => setRaising(false)}>Close</button>
          </div>
        </form>
      )}
    </>
  );
}

export function StockPage() {
  const clinic = useClinic();
  const [adjusting, setAdjusting] = useState<string | null>(null);
  const [onHand, setOnHand] = useState('');
  const manager = clinic.session?.role === 'manager';
  return (
    <>
      <header className="page-head"><p className="eyebrow">Cupboard</p><h1>Stock</h1></header>
      <Status text={clinic.status} />
      <ul className="list">
        {clinic.stock.map(item => (
          <li key={item.id}>
            <div>
              <b>{item.name}</b>
              <div className="muted"><span className="num">{item.onHand}</span> on hand {item.onHand <= LOW_AT && <em className="low">Low</em>}</div>
            </div>
            {manager && <button type="button" onClick={() => { setAdjusting(item.id); setOnHand(String(item.onHand)); clinic.clearStatus(); }}>Adjust {item.name}</button>}
          </li>
        ))}
      </ul>
      {adjusting && (
        <form className="drawer" onSubmit={e => {
          e.preventDefault();
          if (clinic.adjustStock(adjusting, onHand)) setAdjusting(null);
        }}>
          <h2>Adjust stock</h2>
          <Field label="On hand"><input value={onHand} onChange={e => setOnHand(e.target.value)} /></Field>
          <div className="actions">
            <button type="submit" className="primary">Save stock</button>
            <button type="button" onClick={() => setAdjusting(null)}>Close</button>
          </div>
        </form>
      )}
    </>
  );
}

export function LabsPage() {
  const clinic = useClinic();
  const [open, setOpen] = useState(false);
  const [recording, setRecording] = useState<string | null>(null);
  const [patientId, setPatientId] = useState('');
  const [test, setTest] = useState('');
  const [result, setResult] = useState('');
  return (
    <>
      <header className="page-head row">
        <div><p className="eyebrow">Orders</p><h1>Labs</h1></div>
        <button type="button" className="primary" onClick={() => { setOpen(true); setRecording(null); clinic.clearStatus(); }}>Order lab</button>
      </header>
      <Status text={clinic.status} />
      <ul className="list">
        {clinic.labs.map(lab => {
          const patient = clinic.patients.find(p => p.id === lab.patientId);
          return (
            <li key={lab.id}>
              <div>
                <b>{lab.test}</b>
                <div className="muted">{patient?.name} · {lab.result || 'Pending'}</div>
              </div>
              {!lab.result && (
                <button type="button" onClick={() => {
                  clinic.clearStatus();
                  if (clinic.session?.role !== 'manager') { clinic.recordResult(lab.id, ''); return; }
                  setRecording(lab.id);
                  setOpen(false);
                  setResult('');
                }}>Record {lab.test}</button>
              )}
            </li>
          );
        })}
        {clinic.labs.length === 0 && <li>No lab orders this session.</li>}
      </ul>
      {open && (
        <form className="drawer" onSubmit={e => {
          e.preventDefault();
          if (clinic.orderLab({ patientId, test })) { setOpen(false); setPatientId(''); setTest(''); }
        }}>
          <h2>Order lab</h2>
          <Field label="Patient">
            <select value={patientId} onChange={e => setPatientId(e.target.value)}>
              <option value="">Choose a patient</option>
              {clinic.patients.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </Field>
          <Field label="Test"><input value={test} onChange={e => setTest(e.target.value)} /></Field>
          <div className="actions">
            <button type="submit" className="primary">Save lab</button>
            <button type="button" onClick={() => setOpen(false)}>Close</button>
          </div>
        </form>
      )}
      {recording && (
        <form className="drawer" onSubmit={e => {
          e.preventDefault();
          if (clinic.recordResult(recording, result)) { setRecording(null); setResult(''); }
        }}>
          <h2>Record result</h2>
          <Field label="Result"><input value={result} onChange={e => setResult(e.target.value)} /></Field>
          <div className="actions">
            <button type="submit" className="primary">Save result</button>
            <button type="button" onClick={() => setRecording(null)}>Close</button>
          </div>
        </form>
      )}
    </>
  );
}

export function ReferralsPage() {
  const clinic = useClinic();
  const [open, setOpen] = useState(false);
  const [patientId, setPatientId] = useState('');
  const [specialty, setSpecialty] = useState('');
  const [reason, setReason] = useState('');
  return (
    <>
      <header className="page-head row">
        <div><p className="eyebrow">Out</p><h1>Referrals</h1></div>
        <button type="button" className="primary" onClick={() => {
          clinic.clearStatus();
          if (clinic.session?.role !== 'manager') { clinic.refer({ patientId: '', specialty: '', reason: '' }); return; }
          setOpen(true);
        }}>New referral</button>
      </header>
      <Status text={clinic.status} />
      <ul className="list">
        {clinic.referrals.map(item => {
          const patient = clinic.patients.find(p => p.id === item.patientId);
          return <li key={item.id}><div><b>{item.specialty}</b><div className="muted">{patient?.name} · {item.reason}</div></div></li>;
        })}
        {clinic.referrals.length === 0 && <li>No referrals this session.</li>}
      </ul>
      {open && (
        <form className="drawer" onSubmit={e => {
          e.preventDefault();
          if (clinic.refer({ patientId, specialty, reason })) { setOpen(false); setPatientId(''); setSpecialty(''); setReason(''); }
        }}>
          <h2>New referral</h2>
          <Field label="Patient">
            <select value={patientId} onChange={e => setPatientId(e.target.value)}>
              <option value="">Choose a patient</option>
              {clinic.patients.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </Field>
          <Field label="Specialty"><input value={specialty} onChange={e => setSpecialty(e.target.value)} /></Field>
          <Field label="Reason"><input value={reason} onChange={e => setReason(e.target.value)} /></Field>
          <div className="actions">
            <button type="submit" className="primary">Send referral</button>
            <button type="button" onClick={() => setOpen(false)}>Close</button>
          </div>
        </form>
      )}
    </>
  );
}

export function ReportsPage() {
  const { invoices } = useClinic();
  const unpaid = invoices.filter(i => i.status === 'Unpaid');
  const total = unpaid.reduce((sum, i) => sum + Number(i.amount), 0).toFixed(2);
  return (
    <>
      <header className="page-head"><p className="eyebrow">Desk summary</p><h1>Reports</h1></header>
      <section className="board" aria-label="Report">
        <p>Unpaid {money(total)}</p>
        <p>{unpaid.length} unpaid {unpaid.length === 1 ? 'invoice' : 'invoices'}</p>
        <p>Clinic day 11 October 2026</p>
      </section>
    </>
  );
}

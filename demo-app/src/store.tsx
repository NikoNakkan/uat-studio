import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import {
  ACCOUNTS, SEED_APPOINTMENTS, SEED_INVOICES, SEED_LABS, SEED_PATIENTS, SEED_STOCK, SESSION_KEY, money,
  type Appointment, type Invoice, type LabOrder, type Note, type Patient, type Prescription, type Referral, type Session, type StockItem,
} from './model';

type Clinic = {
  session: Session | null;
  patients: Patient[];
  appointments: Appointment[];
  prescriptions: Prescription[];
  invoices: Invoice[];
  stock: StockItem[];
  notes: Note[];
  referrals: Referral[];
  labs: LabOrder[];
  status: string;
  login: (email: string, password: string) => string;
  logout: () => void;
  addPatient: (input: { name: string; mrn: string; dob: string; phone: string }) => boolean;
  book: (input: { patientId: string; date: string; time: string; clinician: string }) => boolean;
  deleteAppointment: (id: string) => void;
  checkIn: (id: string) => boolean;
  prescribe: (input: { patientId: string; medicine: string; dose: string }) => boolean;
  pay: (id: string, method: string) => boolean;
  raiseInvoice: (input: { patientId: string; amount: string }) => boolean;
  adjustStock: (id: string, onHand: string) => boolean;
  setFollowUp: (patientId: string, date: string) => boolean;
  addNote: (patientId: string, text: string) => boolean;
  removeAllergy: (patientId: string, allergy: string) => void;
  refer: (input: { patientId: string; specialty: string; reason: string }) => boolean;
  orderLab: (input: { patientId: string; test: string }) => boolean;
  recordResult: (id: string, result: string) => boolean;
  clearStatus: () => void;
};

const Ctx = createContext<Clinic | null>(null);

export function ClinicProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(() => loadInitial());
  const [patients, setPatients] = useState<Patient[]>(SEED_PATIENTS);
  const [appointments, setAppointments] = useState<Appointment[]>(SEED_APPOINTMENTS);
  const [prescriptions, setPrescriptions] = useState<Prescription[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>(SEED_INVOICES);
  const [stock, setStock] = useState<StockItem[]>(SEED_STOCK);
  const [notes, setNotes] = useState<Note[]>([]);
  const [referrals, setReferrals] = useState<Referral[]>([]);
  const [labs, setLabs] = useState<LabOrder[]>(SEED_LABS);
  const [status, setStatus] = useState('');

  const api = useMemo<Clinic>(() => ({
    session, patients, appointments, prescriptions, invoices, stock, notes, referrals, labs, status,
    login(email, password) {
      const account = ACCOUNTS[email.trim().toLowerCase()];
      if (!account || account.password !== password) return 'Unknown email or password.';
      const next = { email: email.trim().toLowerCase(), name: account.name, role: account.role };
      localStorage.setItem(SESSION_KEY, JSON.stringify(next));
      setSession(next);
      setStatus('');
      return '';
    },
    logout() {
      localStorage.removeItem(SESSION_KEY);
      setSession(null);
      setStatus('');
    },
    addPatient(input) {
      const name = input.name.trim();
      const mrn = input.mrn.trim();
      const dob = input.dob.trim();
      if (!name) { setStatus('Enter a full name.'); return false; }
      if (!mrn) { setStatus('Enter an MRN.'); return false; }
      if (!dob) { setStatus('Enter a date of birth.'); return false; }
      if (patients.some(p => p.mrn === mrn)) { setStatus(`MRN ${mrn} is already on file.`); return false; }
      setPatients(list => [...list, { id: `p-${mrn}`, name, mrn, dob, phone: input.phone.trim() || 'not set', followUp: 'not set', allergies: [] }]);
      setStatus(`Added patient ${name}`);
      return true;
    },
    book(input) {
      if (!input.patientId) { setStatus('Choose a patient.'); return false; }
      if (!input.date.trim()) { setStatus('Enter a date.'); return false; }
      if (!input.time.trim()) { setStatus('Enter a time.'); return false; }
      if (!input.clinician.trim()) { setStatus('Enter a clinician.'); return false; }
      const patient = patients.find(p => p.id === input.patientId);
      if (!patient) { setStatus('Choose a patient.'); return false; }
      const date = input.date.trim();
      const time = input.time.trim();
      const clinician = input.clinician.trim();
      if (appointments.some(a => a.patientId === patient.id && a.date === date && a.time === time)) {
        setStatus(`${patient.name} is already booked at ${time}.`);
        return false;
      }
      if (appointments.some(a => a.clinician === clinician && a.date === date && a.time === time)) {
        setStatus(`${clinician} is already booked at ${time}.`);
        return false;
      }
      setAppointments(list => [...list, {
        id: `a-${Date.now()}`, patientId: patient.id, date, time, clinician, reason: 'Visit', status: 'Booked',
      }]);
      setStatus(`Booked ${patient.name} at ${time}`);
      return true;
    },
    deleteAppointment(id) {
      const row = appointments.find(a => a.id === id);
      const patient = patients.find(p => p.id === row?.patientId);
      setAppointments(list => list.filter(a => a.id !== id));
      setStatus(row && patient ? `Deleted the ${row.time} appointment for ${patient.name}` : 'Deleted the appointment');
    },
    checkIn(id) {
      const row = appointments.find(a => a.id === id);
      const patient = patients.find(p => p.id === row?.patientId);
      if (!row || !patient) { setStatus('That visit is not on the book.'); return false; }
      if (row.status === 'Arrived') { setStatus(`${patient.name} is already checked in.`); return false; }
      setAppointments(list => list.map(a => a.id === id ? { ...a, status: 'Arrived' } : a));
      setStatus(`${patient.name} is checked in`);
      return true;
    },
    prescribe(input) {
      if (session?.role !== 'manager') { setStatus('Only a manager can prescribe.'); return false; }
      if (!input.patientId) { setStatus('Choose a patient.'); return false; }
      const medicine = input.medicine.trim();
      const dose = input.dose.trim();
      if (!medicine) { setStatus('Enter a medicine.'); return false; }
      if (!dose) { setStatus('Enter a dose.'); return false; }
      const patient = patients.find(p => p.id === input.patientId);
      if (!patient) { setStatus('Choose a patient.'); return false; }
      const allergy = patient.allergies.find(item => item.toLowerCase() === medicine.toLowerCase());
      if (allergy) { setStatus(`${patient.name} is allergic to ${allergy}.`); return false; }
      setPrescriptions(list => [...list, { id: `rx-${Date.now()}`, patientId: patient.id, medicine, dose }]);
      setStatus(`Prescribed ${medicine} for ${patient.name}`);
      return true;
    },
    pay(id, method) {
      if (session?.role !== 'manager') { setStatus('Only a manager can take payment.'); return false; }
      if (!method.trim()) { setStatus('Enter a method.'); return false; }
      const invoice = invoices.find(i => i.id === id);
      if (!invoice) { setStatus('That invoice is not on the list.'); return false; }
      setInvoices(list => list.map(i => i.id === id ? { ...i, status: 'Paid' } : i));
      setStatus(`Paid ${id}`);
      return true;
    },
    raiseInvoice(input) {
      if (session?.role !== 'manager') { setStatus('Only a manager can raise an invoice.'); return false; }
      if (!input.patientId) { setStatus('Choose a patient.'); return false; }
      const raw = input.amount.trim();
      if (!/^\d+(\.\d{1,2})?$/.test(raw) || Number(raw) <= 0) { setStatus('Enter an amount.'); return false; }
      const patient = patients.find(p => p.id === input.patientId);
      if (!patient) { setStatus('Choose a patient.'); return false; }
      const amount = Number(raw).toFixed(2);
      const seq = invoices.reduce((max, invoice) => {
        const match = /^INV-(\d+)$/.exec(invoice.id);
        return match ? Math.max(max, Number(match[1])) : max;
      }, 100);
      const id = `INV-${seq + 1}`;
      setInvoices(list => [...list, { id, patientId: patient.id, amount, status: 'Unpaid' }]);
      setStatus(`Raised ${id} for ${money(amount)}`);
      return true;
    },
    adjustStock(id, raw) {
      if (session?.role !== 'manager') { setStatus('Only a manager can adjust stock.'); return false; }
      const onHand = Number(raw);
      if (!raw.trim() || Number.isNaN(onHand) || onHand < 0 || !Number.isInteger(onHand)) {
        setStatus('Enter a whole number of units on hand.');
        return false;
      }
      const item = stock.find(s => s.id === id);
      if (!item) { setStatus('That item is not in stock.'); return false; }
      setStock(list => list.map(s => s.id === id ? { ...s, onHand } : s));
      setStatus(`${item.name} is now ${onHand} on hand`);
      return true;
    },
    setFollowUp(patientId, date) {
      const when = date.trim();
      const patient = patients.find(p => p.id === patientId);
      if (!patient) { setStatus('That patient is not on file.'); return false; }
      if (!when) { setStatus('Enter a follow-up date.'); return false; }
      setPatients(list => list.map(p => p.id === patientId ? { ...p, followUp: when } : p));
      setStatus(`Follow-up for ${patient.name} is ${when}`);
      return true;
    },
    addNote(patientId, text) {
      const body = text.trim();
      const patient = patients.find(p => p.id === patientId);
      if (!patient) { setStatus('That patient is not on file.'); return false; }
      if (!body) { setStatus('Enter a note.'); return false; }
      setNotes(list => [...list, { id: `n-${Date.now()}`, patientId, text: body }]);
      setStatus(`Saved a note for ${patient.name}`);
      return true;
    },
    removeAllergy(patientId, allergy) {
      const patient = patients.find(p => p.id === patientId);
      setPatients(list => list.map(p => p.id === patientId ? { ...p, allergies: p.allergies.filter(item => item !== allergy) } : p));
      setStatus(patient ? `Removed ${allergy} for ${patient.name}` : 'Removed the allergy');
    },
    refer(input) {
      if (session?.role !== 'manager') { setStatus('Only a manager can send a referral.'); return false; }
      if (!input.patientId) { setStatus('Choose a patient.'); return false; }
      const specialty = input.specialty.trim();
      const reason = input.reason.trim();
      if (!specialty) { setStatus('Enter a specialty.'); return false; }
      if (!reason) { setStatus('Enter a reason.'); return false; }
      const patient = patients.find(p => p.id === input.patientId);
      if (!patient) { setStatus('Choose a patient.'); return false; }
      setReferrals(list => [...list, { id: `r-${Date.now()}`, patientId: patient.id, specialty, reason }]);
      setStatus(`Sent a referral for ${patient.name} to ${specialty}`);
      return true;
    },
    orderLab(input) {
      if (!input.patientId) { setStatus('Choose a patient.'); return false; }
      const test = input.test.trim();
      if (!test) { setStatus('Enter a test.'); return false; }
      const patient = patients.find(p => p.id === input.patientId);
      if (!patient) { setStatus('Choose a patient.'); return false; }
      setLabs(list => [...list, { id: `lab-${Date.now()}`, patientId: patient.id, test, result: '' }]);
      setStatus(`Ordered ${test} for ${patient.name}`);
      return true;
    },
    recordResult(id, raw) {
      if (session?.role !== 'manager') { setStatus('Only a manager can record a result.'); return false; }
      const result = raw.trim();
      if (!result) { setStatus('Enter a result.'); return false; }
      const lab = labs.find(item => item.id === id);
      if (!lab) { setStatus('That lab order is not on the list.'); return false; }
      setLabs(list => list.map(item => item.id === id ? { ...item, result } : item));
      setStatus(`Recorded ${result} for ${lab.test}`);
      return true;
    },
    clearStatus() { setStatus(''); },
  }), [appointments, invoices, labs, notes, patients, referrals, session, status, stock]);

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function useClinic() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('ClinicProvider is missing');
  return ctx;
}

function loadInitial(): Session | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Session;
    if (!parsed?.email || !ACCOUNTS[parsed.email]) return null;
    return parsed;
  } catch {
    return null;
  }
}

export type Role = 'employee' | 'manager';

export type Session = { email: string; name: string; role: Role };

export type Patient = {
  id: string;
  name: string;
  mrn: string;
  dob: string;
  phone: string;
  followUp: string;
  allergies: string[];
};

export type Appointment = {
  id: string;
  patientId: string;
  date: string;
  time: string;
  clinician: string;
  reason: string;
  status: 'Booked' | 'Arrived';
};

export type Prescription = { id: string; patientId: string; medicine: string; dose: string };

export type Invoice = { id: string; patientId: string; amount: string; status: 'Unpaid' | 'Paid' };

export type StockItem = { id: string; name: string; onHand: number };

export type Note = { id: string; patientId: string; text: string };

export type Referral = { id: string; patientId: string; specialty: string; reason: string };

export type LabOrder = { id: string; patientId: string; test: string; result: string };

export const CLINIC_DAY = '11 October 2026';
export const LOW_AT = 5;
export const SESSION_KEY = 'lumen-session';

export const ACCOUNTS: Record<string, { password: string; name: string; role: Role }> = {
  'employee@lumen.test': { password: 'Harbor-Employee-1', name: 'Nora Ellis', role: 'employee' },
  'manager@lumen.test': { password: 'Harbor-Manager-1', name: 'Samir Haddad', role: 'manager' },
};

export const SEED_PATIENTS: Patient[] = [
  { id: 'p-ada', name: 'Ada Lovelace', mrn: '1001', dob: '1815-12-10', phone: '555-0148', followUp: 'not set', allergies: ['Penicillin'] },
  { id: 'p-alan', name: 'Alan Turing', mrn: '1002', dob: '1912-06-23', phone: '555-0199', followUp: 'not set', allergies: [] },
];

export const SEED_APPOINTMENTS: Appointment[] = [
  { id: 'a-1', patientId: 'p-ada', date: '2026-10-11', time: '09:00', clinician: 'Dr. Idris', reason: 'Check-up', status: 'Booked' },
];

export const SEED_LABS: LabOrder[] = [
  { id: 'lab-1', patientId: 'p-ada', test: 'Full blood count', result: '' },
];

export const SEED_INVOICES: Invoice[] = [
  { id: 'INV-100', patientId: 'p-ada', amount: '40.00', status: 'Unpaid' },
  { id: 'INV-101', patientId: 'p-alan', amount: '15.00', status: 'Paid' },
];

export const SEED_STOCK: StockItem[] = [
  { id: 'gauze', name: 'Gauze', onHand: 20 },
  { id: 'para', name: 'Paracetamol', onHand: 4 },
  { id: 'saline', name: 'Saline', onHand: 12 },
];

export function money(amount: string) {
  return `€${amount}`;
}

export function loadSession(): Session | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Session;
    if (!parsed?.email || !parsed.role || !parsed.name) return null;
    return parsed;
  } catch {
    return null;
  }
}

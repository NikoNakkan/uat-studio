import { describe, expect, it } from 'vitest';
import { NAV, START, edgesOf, groupOf, layout, pathTo, type MapPage } from './graph';

// Shaped like the Lumen Clinic app map Playwright's planner wrote.
const pages: Record<string, MapPage> = {
  today: { address: 'http://localhost:4173/', reached_by: 'start page; also the "Today" link in the side navigation' },
  login: { address: 'http://localhost:4173/login', reached_by: 'click "Sign out" on the Today page' },
  billing: { address: 'http://localhost:4173/billing', reached_by: 'start page for the Manager seed; for the Employee, click the link "Billing" on the Today page' },
  patients: { address: 'http://localhost:4173/patients', reached_by: 'start page (seed lands on Today, then go to the address); also the "Patients" link in the side navigation' },
  patient_record: { address: 'http://localhost:4173/patients/p-ada', reached_by: 'click the link "Ada Lovelace" on the Patients page' },
};

describe('edgesOf', () => {
  const edges = edgesOf(pages);
  const has = (from: string, to: string, label: string) => edges.some(e => e.from === from && e.to === to && e.label === label);

  it('reads "click X on the Y page" as an arrow from Y labelled X', () => {
    expect(has('today', 'login', 'Sign out')).toBe(true);
    expect(has('today', 'billing', 'Billing')).toBe(true);
    expect(has('patients', 'patient_record', 'Ada Lovelace')).toBe(true);
  });
  it('reads the side navigation as one hub, reached from the home page', () => {
    expect(has(NAV, 'patients', 'Patients')).toBe(true);
    expect(has('today', NAV, 'on every page')).toBe(true);
  });
  it('starts at the root page only, not at every page that says "start page"', () => {
    expect(edges.filter(e => e.from === START).map(e => e.to)).toEqual(['today']);
  });
});

describe('pathTo and layout', () => {
  const edges = edgesOf(pages);
  it('gives the clicks from the start to a page', () => {
    expect(pathTo('patient_record', edges).map(e => e.to)).toEqual(['today', NAV, 'patients', 'patient_record']);
  });
  it('puts each page in the column of its distance from the start', () => {
    const { depth } = layout(Object.keys(pages), edges);
    expect([depth.today, depth.login, depth[NAV], depth.patients, depth.patient_record]).toEqual([1, 2, 2, 3, 4]);
  });
});

describe('groupOf', () => {
  it('sorts elements into actions, fields, messages and structure', () => {
    expect([{ role: 'button' }, { role: 'combobox' }, { role: 'status' }, { role: 'dialog' }].map(groupOf))
      .toEqual(['actions', 'fields', 'messages', 'structure']);
  });
});

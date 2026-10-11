import { describe as group, expect, it } from 'vitest';
import { describe, parse, scriptName } from './describe';

group('parse', () => {
  it('reads complete JSON', () => {
    expect(parse('{"url": "http://localhost:4173/", "n": 2}')).toEqual({ url: 'http://localhost:4173/', n: 2 });
  });
  it('reads JSON cut at 300 characters, keeping the last value even though it is cut short', () => {
    expect(parse('{"element": "Save", "ref": "e12", "text": "a long text that was cut')).toEqual({ element: 'Save', ref: 'e12', text: 'a long text that was cut' });
  });
  it('gives nothing for nothing, or for JSON that is not an object', () => {
    expect([parse(undefined), parse('[1, 2]')]).toEqual([{}, {}]);
  });
});

group('describe', () => {
  it('says what a browser step did, in plain words', () => {
    expect(describe('playwright-test/browser_click', { element: 'Save invoice' })).toBe('Clicked “Save invoice”');
    expect(describe('browser_type', { element: 'Amount', text: '25.00' })).toBe('Typed “25.00” into “Amount”');
    expect(describe('browser_select_option', { element: 'Patient', values: ['Ada Lovelace'] })).toBe('Chose “Ada Lovelace” in “Patient”');
    expect(describe('browser_navigate', { url: 'http://localhost:4173/billing' })).toBe('Opened http://localhost:4173/billing');
  });
  it('reads nested and list fields safely', () => {
    expect(describe('test_debug', { test: { title: 'TC-35 Raise an invoice' } })).toBe('Debugged TC-35 Raise an invoice');
    expect(describe('test_run', { locations: ['a.spec.ts', 'b.spec.ts'] })).toBe('Ran a.spec.ts, b.spec.ts');
    expect(describe('test_debug', { test: 'not an object' })).toBe('Debugged a test');
  });
  it('falls back to the tool name and its first text value', () => {
    expect(describe('record_answer', { test_id: 'TC-18', answer: 'yes' })).toBe('Record answer “TC-18”');
    expect(describe('list_run_files', {})).toBe('list run files');
  });
});

group('scriptName', () => {
  it('names a script by its file, or a command by its start', () => {
    expect(scriptName('.github/skills/x/scripts/check_login.py --all')).toBe('check_login.py');
    expect(scriptName(undefined)).toBe('a script');
  });
});

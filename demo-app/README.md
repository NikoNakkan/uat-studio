# Lumen Clinic

A clinic desk used as the app under test for UAT Studio. It is one morning of work: patients, the book, check-in, notes, follow-up, allergies, labs, referrals, prescriptions, billing, stock, and a report. Two people share it, and they cannot do the same things.

The kit's guardrails allow only `http://localhost:4173`, so this app listens there.

## Run it

```
cd demo-app
npm install
npm run dev
```

Open http://localhost:4173.

## Accounts

Type these on the UAT Studio Setup page. The names are already in the kit's `.env.example`. The passwords stay in `.env` and never go in the Excel.

| Login as | User | Password | Can |
| --- | --- | --- | --- |
| Employee test account | `employee@lumen.test` | `Harbor-Employee-1` | Today, patients, notes, follow-up, check-in, labs, referrals list, stock, reports. Not billing, prescriptions, recording a lab result, or sending a referral. |
| Manager test account | `manager@lumen.test` | `Harbor-Manager-1` | Everything, including pay, prescribe, raise an invoice, record a lab result, send a referral, and adjust stock. |

On the desk they appear as Nora Ellis and Samir Haddad.

Each browser visit starts from the same morning: Ada at 09:00 still Booked, allergic to Penicillin, a pending full blood count, INV-100 unpaid, paracetamol low. Signing in is remembered. The book itself is not, so one test does not leave rows behind for the next.

## UAT workbooks

| File | When to upload it |
| --- | --- |
| `uat/lumen-clinic-tests.xlsx` | The first run. 37 cases. TC-18 and TC-37 are vague on purpose, so clarification has something to ask. TC-19 and TC-38 are manual calls, recorded at sign-off, never generated. |
| `uat/lumen-clinic-tests-v2.xlsx` | A later run of the same pack. TC-04 is only reworded, TC-08 moves 14:30 to 15:00, TC-14 is gone, TC-20 is new and close to TC-05. The new desk cases are in both packs. |
| `uat/lumen-clinic-tests-v3.xlsx` | The demo of a caught bug. Same as v2, plus TC-15 now sets paracetamol to 6 instead of 8, and TC-39 is new: pay INV-100 while Ada also owes INV-102. TC-39 fails on purpose (see Planted bug). |
| `uat/lumen-clinic-tests-v4.xlsx` | v3 plus: TC-31 orders HbA1c instead of a lipid panel; new TC-40 (search ignores capital letters), TC-41 (a note stays on its own patient), TC-42 (saline at 5 is not low) find the v4 bugs; new TC-43 (urine culture) should pass. |
| `uat/lumen-clinic-demo-10.xlsx` | A short pack for a live demo, as a first run of a fresh project: 10 cases. TC-01, TC-03, TC-04, TC-21, TC-25 and TC-43 should pass; TC-39, TC-40, TC-41 and TC-42 find the four planted bugs. |

Paste `uat/GLOSSARY.md` into Knowledge before the run if you want the clarifier to keep those meanings.

Delete, pay, remove, and send stop for a person. That is the guard, not a bug in the desk.

## Planted bugs

Paying an invoice marks every invoice of that patient as paid, not just the one paid (`pay` in `src/store.tsx` matches on `patientId` instead of `id`). Ada starts with one invoice, so TC-13 and the other cases still pass; only TC-39 in v3 gives her a second one and catches it: the report shows €0.00 unpaid instead of €25.00. To fix it, match on `i.id === id` again.

For v4, three more in `src/pages.tsx`, each found only by a new v4 case:

- **Search is case-sensitive** (`PatientsPage`: the query and names are no longer lower-cased). "Turing" still works (TC-06), "ada" finds nobody (TC-40). Fix: lower-case both again.
- **Every note shows on every patient** (`PatientPage`: the notes filter checks `patientId.startsWith('p-')`, true for everyone). TC-41 finds Ada's note on Alan Turing. Fix: `item.patientId === patient.id`.
- **Low at exactly 5** (`StockPage`: `onHand <= LOW_AT` instead of `<`). TC-42 sets saline to 5 and sees "Low". Fix: `<` again.

Rebuild the workbooks with `python uat/make_cases.py` from `demo-app` (needs `openpyxl`).

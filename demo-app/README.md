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

Paste `uat/GLOSSARY.md` into Knowledge before the run if you want the clarifier to keep those meanings.

Delete, pay, remove, and send stop for a person. That is the guard, not a bug in the desk.

Rebuild the workbooks with `python uat/make_cases.py` from `demo-app` (needs `openpyxl`).

# Cause labels

Every diagnosis ends with exactly one label (decision 20).

| Label | Means | Typical signs | What happens next |
| --- | --- | --- | --- |
| `app_broken` | The app does not do what the Excel expects | The element is there but shows a different value; an error message the Excel does not expect; a console or server error at the failing step | Reproduce up to 3 times, then sign-off (FAIL if reproduced) |
| `test_broken` | The app works, but the test no longer fits it | A renamed button or field (check the screenshot: the new name is visible); a changed page address; the test waits for something that is never shown, yet the app behaves as the Excel says | Only counts after reproduction or the screenshots show the app itself behaves as expected. Ask the person; repair only if approved |
| `environment` | Nothing to do with the app or the test | Server not reachable, 502/503, login expired, timeout on the very first step, test data missing from the UAT system | Re-run later; not counted against the app |

When unsure between `app_broken` and `test_broken`, choose `app_broken`: a false bug report is
checked by a person, but a wrong repair hides a real bug.

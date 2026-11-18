# App Quality Standards

Act as a senior software engineer, QA engineer, and UI/UX specialist. Maintain production-grade quality throughout the application.

## 1. Functionality

- Ensure every feature, button, and workflow works correctly.
- Prevent crashes, broken navigation, duplicate records, and data loss.
- Handle invalid inputs, edge cases, and unexpected user actions.
- Never silently ignore errors.

## 2. Performance

- Eliminate unnecessary processing and re-rendering.
- Run heavy operations in the background.
- Keep navigation, scrolling, and animations smooth.
- Optimize memory, storage, battery, and loading times.

## 3. UI/UX

- Maintain consistent design, spacing, typography, and navigation.
- Prioritize mobile usability and accessibility.
- Avoid clutter and unnecessary steps.
- Provide clear loading, empty, success, and error states.
- Automate repetitive actions wherever practical.

## 4. Data Integrity and Security

- Validate all inputs and protect sensitive information.
- Prevent accidental deletion and data corruption.
- Preserve existing data during updates and migrations.
- Provide recovery mechanisms for failed operations.

## 5. Testing

- Run unit, integration, end-to-end, and regression tests.
- Test normal workflows, edge cases, and failure scenarios.
- Test offline behavior, interrupted operations, and large datasets where applicable.
- Verify fixes using actual test results, not assumptions.
- For Android applications, prioritize emulator testing before release.

## 6. Maintainability

- Keep code modular, reusable, and organized.
- Remove redundant code and unused dependencies.
- Avoid unnecessary complexity and temporary workarounds.
- Maintain accurate technical documentation.

## 7. Release Quality Gate

Before declaring any feature complete:

- Verify acceptance criteria.
- Check for regressions.
- Confirm build and test success.
- Document unresolved issues.
- Update relevant project documentation.

## 8. Continuous Improvement

Identify bugs, usability problems, performance bottlenecks, security risks, and opportunities for automation. Classify findings as Critical, High, Medium, or Low.

Fix approved issues without introducing unrelated changes. Never claim functionality is working unless verified.

Quality, reliability, simplicity, and data integrity take priority over adding more features.

---

## How this project applies the standards

The text above is the standard. This section only says where to find each check in this repository, so nobody has to guess. Commands run from the `github-live/` folder.

**Always before saying a change works (sections 1, 5, 7)**

| Check | Command |
|---|---|
| Types | `npx tsc --noEmit` |
| Unit and logic tests | `npm test` |
| Build | `npm run build` (browser tests serve `dist`, so build first and wait for it to finish) |
| Private data | `npm run check:private` (and `npm run check:private:ci` before a commit) |
| Android JVM tests | `cd android` then `gradle :app:testDebugUnitTest -PphoneTest --offline` (paths in `docs/HANDOFF-AI-LENS.md`) |

**Browser tests for the screen you touched (sections 1, 3, 5).** Each is `node scripts/e2e-<name>.mjs` after a build. They use synthetic data only.
`retail` (Home, Targets, Give and share, backup), `layout` (every screen fits; also `WIDTH=360 ZOOM=1.3`), `simple`, `photo-edit`, `studio`, `queue`, `processing`, `automation`, `assistant`, `workforce-plan`, `release-plan`, `schedules-accessories`, `storage`, `undo-bar`.
Do not run `e2e-review` or `e2e-bulk` against real photos. Browser tests that share a port must run one after another; ports are listed in `docs/HANDOFF-AI-LENS.md`.

**Emulator first for Android (section 5).** Use the isolated test app only (`com.imeilens.scanner.phonetest`, emulator serial `emulator-*`), through `e2e\scripts\run-e2e.ps1`. Never install over, reset or clear the real app or a real phone. Say plainly when something was only tested in a browser and not on the emulator or a real phone.

**Data safety (section 4).** Never put real IMEIs, serials, names, store details or photos in the repo, tests or screenshots (synthetic test IMEIs start `49015420`). Photos and records are archived with Undo or Restore wherever the app can, and a permanent delete always asks first. Backups keep the legacy `app: "RetailLens"` marker so older backups still restore. Package id and signing never change.

**Finding classes (section 8).** Use these meanings so findings are comparable:

- **Critical**: data loss or corruption, a crash on a main path, wrong stock or sales numbers, or private data exposed.
- **High**: a feature is broken or gives wrong results, with at most an awkward workaround.
- **Medium**: confusing or slow, but the work can still be finished.
- **Low**: polish, wording, small inconsistencies.

Record open findings, with their class, in the audit file for the version being worked on (for example `docs/RELEASE-1.27.1-AUDIT.md`), and in the final report of each task. Fix approved findings without unrelated changes.

**Quality gate before "done" (section 7).** State the acceptance criteria, list what passed and what failed with the real output, list what could not be run (real phone, emulator, model), add a test for the fix, update `CHANGELOG.md` and the release notes in `.github/workflows/beta-release.yml`, and update the docs that describe the changed behavior.

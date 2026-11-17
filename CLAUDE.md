# RetailLens: how to work in this project

Offline retail app (React + TypeScript + Vite in an Android WebView, with a native Android scanner). Package id `com.imeilens.scanner` must never change. Signing config stays untouched.

## Every time code is written
1. Look first: check what already exists (search the repo) and reuse it. Smallest change that solves the problem; no unrelated rewrites.
2. Verify before saying "done": run `npx tsc --noEmit` and `npm test`. For any screen change also run the matching browser test (`npm run build`, then `node scripts/e2e-retail.mjs`; `e2e-layout`, `e2e-simple`, `e2e-review`, `e2e-photo-edit` when those screens are touched).
3. Add a test for each fix or feature (unit in `scripts/test-retail-v2.mjs` or an e2e step) and see it pass.
4. Add a line to `CHANGELOG.md` and to the release notes in `.github/workflows/beta-release.yml`.
5. Report honestly: what passed, what failed, what was not tested on a real phone.

## Standing rules
- Commit, push, merge and release only when the user asks in that conversation. Earlier approval does not carry over.
- Releases: push a `beta-v*` tag; the workflow builds the debug-signed APK. History rewrites and force-push need explicit approval.
- Never use real customer data (IMEIs, serials, names, store details, photos) in the repo, tests or any outside service. Synthetic data only (test IMEIs start 49015420).
- Never touch the user's real installed app or its data.
- Simple, plain wording in the app; one title per screen; large tap targets; check at large text size.

## Gotchas
- `npm run build` before browser tests (they serve `dist`). Kill leftover headless Edge on ports 9350-9357 (profile `imei-*`) before a run.
- When writing scripts, avoid shell heredocs for text with backslashes or backticks; use the Write/Edit tools.
- Retail data lives under `retail:` keys in IndexedDB `imei-lens-v2`; pure logic is in `src/retail/` and unit-tested.
- Popups use `useBackLayer` (Back closes them first); screens use `useBackNav`.

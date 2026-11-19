# Handover: live AI provider verification (2026-11-19)

Branch `ai/agent-1.29`, HEAD `7b49423` (local; nothing pushed, merged, tagged or released in this task).

## Status: BLOCKED on API keys. Live tests have NOT run.
No Gemini, Groq or OpenRouter key was available (no environment variable, no keys file). Nothing about live provider behaviour is verified yet. Every item in "To do" below is untested.

## Update: live testing DEFERRED by the user until they have PC access
The user asked for the latest v1.29.0 TEST APK first, for manual phone testing, preserving all data. Prepared: `phase2-results/builds/phone-test-1.29.0/AI-LENS-Test-1.29.0-7b49423.apk` (50,662,115 bytes, SHA-256 `0FB7110D…0384`, identical to `AI-LENS-Test-fin1.apk`), also as 24 MB byte-split parts `.part00/.part01/.part02` (join: `copy /b a.part00 + a.part01 + a.part02 a.apk`, then check the hash). It is a SEPARATE app (`com.imeilens.scanner.phonetest`, label "AI LENS Test"): installing it never touches the real app's data. Do not install the main APK over the real app until the user says so. Resume live provider testing only when the user is back with keys. No merge/release without approval.

## Done and verified (2026-11-19)
- `npx tsc --noEmit`: clean. `npm test`: passes (AI-agent suite with fake providers, safety suites, language sets, APK gate 7/7).
- Both APKs re-hashed and checked with `node scripts/verify-apk.mjs` (needs `JAVA_HOME` = `C:\Program Files\Android\Android Studio\jbr` and `ANDROID_HOME` = `%LOCALAPPDATA%\Android\Sdk`):

| APK (in `phase2-results/builds/`) | SHA-256 | Package / version | Signer |
|---|---|---|---|
| `AI-LENS-1.29.0-7b49423.apk` (main) | `2988C593474A8F95BC1459912F64D4B41DB9CA46057B51B20CEE69C1D66A7632` | `com.imeilens.scanner` 1.29.0 (49), "AI LENS" | `f2a58bb2…7a27`, verifies |
| `AI-LENS-Test-fin1.apk` (isolated test) | `0FB7110D4B59A974CD99540E7E76CC94434CC70127BE5B6865CA56CFFA9D0384` | `com.imeilens.scanner.phonetest` 1.29.0-phonetest (49), "AI LENS Test" | `f2a58bb2…7a27`, verifies |

- Emulators up: `emulator-5554` and `emulator-5562`, both with the `phonetest` app. 5554 also has the real package: never touch it.

## To do once keys exist (no extra approval needed for testing)
1. Put keys in a file OUTSIDE the project, lines `GEMINI_API_KEY=…`, `GROQ_API_KEY=…`, `OPENROUTER_API_KEY=…` (or set the env vars before starting the session).
2. Desktop live check, one provider at a time: `node scripts/live-ai-check.mjs --keys-file <path> --only gemini|groq|openrouter` (12 scenarios + privacy scan).
3. Emulator WebView check, isolated test app only: start `phonetest` on an emulator, `adb -s emulator-XXXX forward tcp:9229 localabstract:webview_devtools_remote_<pid>`, then `ADB_SERIAL=emulator-XXXX node scripts/live-ai-webview.mjs --keys-file <path> --only <provider>` (CORS, Approve, saved+checked, Undo, what-if, no other data changed; removes keys afterwards).
4. Failure paths the scripts do not cover (write a small test or run by hand): bad key, rate limit (429), timeout, provider unreachable, no internet, Gemini Interactions API to legacy fallback, switching provider; each must fall back to the offline assistant with a one-line note and change no data.
5. Key security: key must not appear in request bodies, logs, backups/exports, history card, receipts, repo or reports; cleared from the emulator after.
6. Fix any failure, then rerun `npx tsc --noEmit`, `npm test`, `npm run build` + browser suites (assistant, automation, retail, review), the 102-command regression and the Android check. If code changes: rebuild both APKs, re-hash, re-run `verify-apk`, update the table above.

## Rules for this task (from the user)
Isolated test app only. Never expose or commit API keys. Do not merge, push, tag or release until live verification passes and the user approves. Real phone never touched.

## Risks
- Free-tier rate limits can make a scenario fail without a code bug (scripts retry once and pause 4 s between requests).
- Model results vary; judge repeat failures, not single ones.
